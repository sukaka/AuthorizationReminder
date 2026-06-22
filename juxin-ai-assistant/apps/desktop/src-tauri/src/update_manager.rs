use std::sync::{Arc, Mutex};

use tauri_plugin_updater::Update;
use tokio::sync::oneshot;

use crate::update_state::{
    CheckMode, UpdateFailureStage, UpdateInfo, UpdateMachine, UpdateOperation, UpdatePhase,
};

struct UpdateRuntime {
    machine: UpdateMachine,
    candidate: Option<Update>,
    cancel: Option<(UpdateOperation, oneshot::Sender<()>)>,
}

#[derive(Clone)]
pub struct UpdateManagerState {
    inner: Arc<Mutex<UpdateRuntime>>,
}

impl UpdateManagerState {
    pub fn new(enabled: bool) -> Self {
        Self {
            inner: Arc::new(Mutex::new(UpdateRuntime {
                machine: UpdateMachine::new(enabled, None),
                candidate: None,
                cancel: None,
            })),
        }
    }

    pub fn phase(&self) -> Result<UpdatePhase, String> {
        self.inner
            .lock()
            .map(|runtime| runtime.machine.phase().clone())
            .map_err(|_| "UPDATE_STATE_UNAVAILABLE".to_string())
    }

    pub fn begin_check(&self) -> Result<UpdateOperation, String> {
        self.inner
            .lock()
            .map_err(|_| "UPDATE_STATE_UNAVAILABLE".to_string())?
            .machine
            .begin_check()
    }

    pub fn finish_check(
        &self,
        operation: UpdateOperation,
        update: Option<Update>,
        mode: CheckMode,
        now: u64,
    ) -> Result<UpdatePhase, String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "UPDATE_STATE_UNAVAILABLE".to_string())?;
        let info = update.as_ref().map(update_info).transpose()?;
        runtime.machine.finish_check(operation, info, mode, now);
        runtime.candidate = if matches!(runtime.machine.phase(), UpdatePhase::Available { .. }) {
            update
        } else {
            None
        };
        Ok(runtime.machine.phase().clone())
    }

    pub fn begin_download_with_cancel(
        &self,
    ) -> Result<(UpdateOperation, Update, UpdatePhase, oneshot::Receiver<()>), String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "UPDATE_STATE_UNAVAILABLE".to_string())?;
        let update = runtime
            .candidate
            .clone()
            .ok_or_else(|| "UPDATE_NOT_AVAILABLE".to_string())?;
        let operation = runtime.machine.begin_download()?;
        let (cancel, cancel_receiver) = oneshot::channel();
        runtime.cancel = Some((operation, cancel));
        Ok((
            operation,
            update,
            runtime.machine.phase().clone(),
            cancel_receiver,
        ))
    }

    pub fn record_download(
        &self,
        operation: UpdateOperation,
        chunk_length: usize,
        total: Option<u64>,
    ) -> Result<Option<UpdatePhase>, String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "UPDATE_STATE_UNAVAILABLE".to_string())?;
        if !runtime.machine.is_current_download(operation) {
            return Ok(None);
        }
        runtime
            .machine
            .record_download(operation, chunk_length, total);
        Ok(Some(runtime.machine.phase().clone()))
    }

    pub fn begin_install(&self, operation: UpdateOperation) -> Result<Option<UpdatePhase>, String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "UPDATE_STATE_UNAVAILABLE".to_string())?;
        if !runtime.machine.is_current_download(operation) {
            return Ok(None);
        }
        runtime.cancel = None;
        runtime.machine.begin_install(operation);
        Ok(Some(runtime.machine.phase().clone()))
    }

    pub fn cancel_download(&self) -> Result<(oneshot::Sender<()>, UpdatePhase), String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "UPDATE_STATE_UNAVAILABLE".to_string())?;
        let cancellable = runtime
            .cancel
            .as_ref()
            .is_some_and(|(operation, _)| runtime.machine.is_current_download(*operation));
        if !cancellable {
            return Err("UPDATE_NOT_CANCELLABLE".to_string());
        }
        let (_, cancel) = runtime
            .cancel
            .take()
            .ok_or_else(|| "UPDATE_NOT_CANCELLABLE".to_string())?;
        if !runtime.machine.cancel_download() {
            return Err("UPDATE_NOT_CANCELLABLE".to_string());
        }
        Ok((cancel, runtime.machine.phase().clone()))
    }

    pub fn defer(&self, now: u64) -> Result<UpdatePhase, String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "UPDATE_STATE_UNAVAILABLE".to_string())?;
        runtime
            .machine
            .defer(now)
            .ok_or_else(|| "UPDATE_NOT_AVAILABLE".to_string())?;
        runtime.candidate = None;
        Ok(runtime.machine.phase().clone())
    }

    pub fn fail(
        &self,
        operation: UpdateOperation,
        stage: UpdateFailureStage,
        message: &str,
    ) -> Result<UpdatePhase, String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "UPDATE_STATE_UNAVAILABLE".to_string())?;
        if !runtime.machine.is_current_operation(operation) {
            return Ok(runtime.machine.phase().clone());
        }
        runtime.cancel = None;
        runtime.machine.fail(operation, stage, message);
        Ok(runtime.machine.phase().clone())
    }
}

fn update_info(update: &Update) -> Result<UpdateInfo, String> {
    if update.download_url.scheme() != "https"
        || !update.download_url.username().is_empty()
        || update.download_url.password().is_some()
    {
        return Err("UPDATE_DOWNLOAD_URL_UNSAFE".to_string());
    }
    let content_length = update
        .raw_json
        .get("contentLength")
        .and_then(serde_json::Value::as_u64);
    Ok(UpdateInfo::new(
        &update.version,
        update.body.as_deref().unwrap_or(""),
        content_length,
    ))
}
