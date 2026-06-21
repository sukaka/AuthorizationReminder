use std::collections::HashMap;

use tokio::sync::watch;

#[derive(Debug)]
pub struct ModelCancellationHandle {
    request_id: String,
    instance_id: u64,
    receiver: watch::Receiver<bool>,
}

impl ModelCancellationHandle {
    pub const fn receiver(&self) -> &watch::Receiver<bool> {
        &self.receiver
    }
}

#[derive(Debug, Default)]
pub struct ModelCancellationRegistry {
    next_instance_id: u64,
    active: HashMap<String, (u64, watch::Sender<bool>)>,
}

impl ModelCancellationRegistry {
    pub fn start(&mut self, request_id: &str) -> ModelCancellationHandle {
        self.next_instance_id = self.next_instance_id.wrapping_add(1);
        let instance_id = self.next_instance_id;
        let (sender, receiver) = watch::channel(false);
        if let Some((_, previous)) = self
            .active
            .insert(request_id.to_string(), (instance_id, sender))
        {
            let _ = previous.send(true);
        }
        ModelCancellationHandle {
            request_id: request_id.to_string(),
            instance_id,
            receiver,
        }
    }

    pub fn finish(&mut self, handle: &ModelCancellationHandle) {
        let matches_current = self
            .active
            .get(&handle.request_id)
            .is_some_and(|(instance_id, _)| *instance_id == handle.instance_id);
        if matches_current {
            self.active.remove(&handle.request_id);
        }
    }

    pub fn cancel(&mut self, request_id: &str) {
        if let Some((_, sender)) = self.active.remove(request_id) {
            let _ = sender.send(true);
        }
    }

    pub fn cancel_all(&mut self) {
        let active = std::mem::take(&mut self.active);
        for (_, (_, sender)) in active {
            let _ = sender.send(true);
        }
    }

    pub fn is_empty(&self) -> bool {
        self.active.is_empty()
    }
}
