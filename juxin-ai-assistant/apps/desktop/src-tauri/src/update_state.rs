use serde::{Deserialize, Serialize};

pub const DEFER_SECONDS: u64 = 24 * 60 * 60;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub content_length: Option<u64>,
}

impl UpdateInfo {
    pub fn new(version: &str, notes: &str, content_length: Option<u64>) -> Self {
        Self {
            version: version.to_string(),
            notes: notes.to_string(),
            content_length,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateFailureStage {
    Check,
    Download,
    Install,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum UpdatePhase {
    Idle {
        enabled: bool,
    },
    Checking,
    Available {
        update: UpdateInfo,
    },
    Downloading {
        update: UpdateInfo,
        received: u64,
        total: Option<u64>,
    },
    Installing {
        update: UpdateInfo,
    },
    Failed {
        stage: UpdateFailureStage,
        update: Option<UpdateInfo>,
        message: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDeferral {
    version: String,
    deferred_at: u64,
}

impl UpdateDeferral {
    pub fn new(version: &str, deferred_at: u64) -> Self {
        Self {
            version: version.to_string(),
            deferred_at,
        }
    }

    fn suppresses(&self, version: &str, now: u64) -> bool {
        self.version == version && now < self.deferred_at.saturating_add(DEFER_SECONDS)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CheckMode {
    Automatic,
    Manual,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UpdateOperation(u64);

pub struct UpdateMachine {
    phase: UpdatePhase,
    generation: u64,
    deferral: Option<UpdateDeferral>,
}

impl UpdateMachine {
    pub const fn new(enabled: bool, deferral: Option<UpdateDeferral>) -> Self {
        Self {
            phase: UpdatePhase::Idle { enabled },
            generation: 0,
            deferral,
        }
    }

    pub const fn phase(&self) -> &UpdatePhase {
        &self.phase
    }

    pub fn begin_check(&mut self) -> Result<UpdateOperation, String> {
        match self.phase {
            UpdatePhase::Idle { enabled: false } => return Err("UPDATER_DISABLED".to_string()),
            UpdatePhase::Checking
            | UpdatePhase::Downloading { .. }
            | UpdatePhase::Installing { .. } => {
                return Err("UPDATE_BUSY".to_string());
            }
            UpdatePhase::Idle { enabled: true }
            | UpdatePhase::Available { .. }
            | UpdatePhase::Failed { .. } => {}
        }
        let operation = self.next_operation();
        self.phase = UpdatePhase::Checking;
        Ok(operation)
    }

    pub fn finish_check(
        &mut self,
        operation: UpdateOperation,
        update: Option<UpdateInfo>,
        mode: CheckMode,
        now: u64,
    ) {
        if !self.is_current(operation) || !matches!(self.phase, UpdatePhase::Checking) {
            return;
        }
        self.phase = match update {
            Some(update)
                if mode == CheckMode::Automatic
                    && self
                        .deferral
                        .as_ref()
                        .is_some_and(|deferred| deferred.suppresses(&update.version, now)) =>
            {
                UpdatePhase::Idle { enabled: true }
            }
            Some(update) => UpdatePhase::Available { update },
            None => UpdatePhase::Idle { enabled: true },
        };
    }

    pub fn begin_download(&mut self) -> Result<UpdateOperation, String> {
        let UpdatePhase::Available { update } = &self.phase else {
            return Err("UPDATE_NOT_AVAILABLE".to_string());
        };
        let update = update.clone();
        let operation = self.next_operation();
        self.phase = UpdatePhase::Downloading {
            update,
            received: 0,
            total: None,
        };
        Ok(operation)
    }

    pub fn record_download(
        &mut self,
        operation: UpdateOperation,
        chunk_length: usize,
        total: Option<u64>,
    ) {
        if !self.is_current(operation) {
            return;
        }
        if let UpdatePhase::Downloading {
            received,
            total: expected,
            ..
        } = &mut self.phase
        {
            let chunk_length = u64::try_from(chunk_length).unwrap_or(u64::MAX);
            *received = received.saturating_add(chunk_length);
            if total.is_some() {
                *expected = total;
            }
        }
    }

    pub fn begin_install(&mut self, operation: UpdateOperation) {
        if !self.is_current(operation) {
            return;
        }
        if let UpdatePhase::Downloading { update, .. } = &self.phase {
            self.phase = UpdatePhase::Installing {
                update: update.clone(),
            };
        }
    }

    pub fn cancel_download(&mut self) -> bool {
        let UpdatePhase::Downloading { update, .. } = &self.phase else {
            return false;
        };
        let update = update.clone();
        self.next_operation();
        self.phase = UpdatePhase::Available { update };
        true
    }

    pub fn is_current_download(&self, operation: UpdateOperation) -> bool {
        self.is_current(operation) && matches!(self.phase, UpdatePhase::Downloading { .. })
    }

    pub fn is_current_operation(&self, operation: UpdateOperation) -> bool {
        self.is_current(operation)
    }

    pub fn defer(&mut self, now: u64) -> Option<UpdateDeferral> {
        let deferral = self.pending_deferral(now)?;
        self.apply_deferral(deferral.clone());
        Some(deferral)
    }

    pub fn pending_deferral(&self, now: u64) -> Option<UpdateDeferral> {
        let UpdatePhase::Available { update } = &self.phase else {
            return None;
        };
        Some(UpdateDeferral::new(&update.version, now))
    }

    pub fn apply_deferral(&mut self, deferral: UpdateDeferral) {
        self.deferral = Some(deferral);
        self.phase = UpdatePhase::Idle { enabled: true };
    }

    pub fn fail(&mut self, operation: UpdateOperation, stage: UpdateFailureStage, message: &str) {
        if !self.is_current(operation) {
            return;
        }
        let update = match &self.phase {
            UpdatePhase::Available { update }
            | UpdatePhase::Downloading { update, .. }
            | UpdatePhase::Installing { update } => Some(update.clone()),
            UpdatePhase::Idle { .. } | UpdatePhase::Checking | UpdatePhase::Failed { .. } => None,
        };
        self.phase = UpdatePhase::Failed {
            stage,
            update,
            message: message.to_string(),
        };
    }

    fn is_current(&self, operation: UpdateOperation) -> bool {
        self.generation == operation.0
    }

    fn next_operation(&mut self) -> UpdateOperation {
        self.generation = self.generation.wrapping_add(1);
        UpdateOperation(self.generation)
    }
}
