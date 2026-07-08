use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};

use crate::keychain::SecretStore;
use crate::local_queue::LocalQueueError;

const APP_ID: &str = "com.juxin.ai-assistant";
const DEVICE_KEY_ACCOUNT: &str = "device-storage-key";
const FILE_VERSION: u8 = 1;

pub(crate) fn device_key(secrets: &dyn SecretStore) -> Result<[u8; 32], LocalQueueError> {
    if let Some(encoded) = secrets
        .get(DEVICE_KEY_ACCOUNT)
        .map_err(|_| LocalQueueError::DeviceKey)?
    {
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| LocalQueueError::DeviceKey)?;
        return bytes.try_into().map_err(|_| LocalQueueError::DeviceKey);
    }
    let mut key = [0_u8; 32];
    SystemRandom::new()
        .fill(&mut key)
        .map_err(|_| LocalQueueError::DeviceKey)?;
    secrets
        .set(DEVICE_KEY_ACCOUNT, &STANDARD.encode(key))
        .map_err(|_| LocalQueueError::DeviceKey)?;
    Ok(key)
}

fn cipher(key: &[u8; 32]) -> Result<LessSafeKey, LocalQueueError> {
    UnboundKey::new(&AES_256_GCM, key)
        .map(LessSafeKey::new)
        .map_err(|_| LocalQueueError::DeviceKey)
}

pub(crate) fn encrypt(
    key: &[u8; 32],
    user_id: &str,
    purpose: &str,
    plaintext: &[u8],
) -> Result<Vec<u8>, LocalQueueError> {
    let mut nonce_bytes = [0_u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| LocalQueueError::DeviceKey)?;
    let mut ciphertext = plaintext.to_vec();
    cipher(key)?
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(aad(user_id, purpose).as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| LocalQueueError::Corrupt)?;
    let mut envelope = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
    envelope.push(FILE_VERSION);
    envelope.extend_from_slice(&nonce_bytes);
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

pub(crate) fn decrypt(
    key: &[u8; 32],
    user_id: &str,
    purpose: &str,
    envelope: &[u8],
) -> Result<Vec<u8>, LocalQueueError> {
    if envelope.len() <= 1 + NONCE_LEN || envelope[0] != FILE_VERSION {
        return Err(LocalQueueError::Corrupt);
    }
    let nonce_bytes: [u8; NONCE_LEN] = envelope[1..=NONCE_LEN]
        .try_into()
        .map_err(|_| LocalQueueError::Corrupt)?;
    let mut ciphertext = envelope[1 + NONCE_LEN..].to_vec();
    let plaintext = cipher(key)?
        .open_in_place(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(aad(user_id, purpose).as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| LocalQueueError::Corrupt)?;
    Ok(plaintext.to_vec())
}

fn aad(user_id: &str, purpose: &str) -> String {
    format!("{APP_ID}:{user_id}:{purpose}")
}
