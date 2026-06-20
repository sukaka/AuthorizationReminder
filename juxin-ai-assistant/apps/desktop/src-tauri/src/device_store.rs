use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};

use crate::keychain::SecretStore;

pub const RESULT_SYNC_KEY_ACCOUNT: &str = "result-sync-key";
const DEVICE_VALUE_LIMIT: usize = 2_500_000;

fn cipher(key: &[u8; 32]) -> Result<LessSafeKey, String> {
    UnboundKey::new(&AES_256_GCM, key)
        .map(LessSafeKey::new)
        .map_err(|_| "DEVICE_STORE_KEY_INVALID".to_string())
}

pub fn encrypt_queue_value(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    let mut nonce_bytes = [0_u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| "DEVICE_STORE_RANDOM_FAILED".to_string())?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let mut encrypted = plaintext.as_bytes().to_vec();
    cipher(key)?
        .seal_in_place_append_tag(nonce, Aad::empty(), &mut encrypted)
        .map_err(|_| "DEVICE_STORE_ENCRYPT_FAILED".to_string())?;
    let mut envelope = nonce_bytes.to_vec();
    envelope.extend(encrypted);
    Ok(STANDARD.encode(envelope))
}

pub fn decrypt_queue_value(key: &[u8; 32], encoded: &str) -> Result<String, String> {
    let envelope = STANDARD
        .decode(encoded)
        .map_err(|_| "DEVICE_STORE_DECRYPT_FAILED".to_string())?;
    if envelope.len() <= NONCE_LEN {
        return Err("DEVICE_STORE_DECRYPT_FAILED".to_string());
    }
    let (nonce_bytes, ciphertext) = envelope.split_at(NONCE_LEN);
    let nonce_array: [u8; NONCE_LEN] = nonce_bytes
        .try_into()
        .map_err(|_| "DEVICE_STORE_DECRYPT_FAILED".to_string())?;
    let mut encrypted = ciphertext.to_vec();
    let plaintext = cipher(key)?
        .open_in_place(
            Nonce::assume_unique_for_key(nonce_array),
            Aad::empty(),
            &mut encrypted,
        )
        .map_err(|_| "DEVICE_STORE_DECRYPT_FAILED".to_string())?;
    String::from_utf8(plaintext.to_vec())
        .map_err(|_| "DEVICE_STORE_DECRYPT_FAILED".to_string())
}

fn load_values(path: &Path) -> Result<BTreeMap<String, String>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let bytes = fs::read(path).map_err(|_| "DEVICE_STORE_READ_FAILED".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "DEVICE_STORE_CORRUPT".to_string())
}

fn save_values(path: &Path, values: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "DEVICE_STORE_WRITE_FAILED".to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(values).map_err(|_| "DEVICE_STORE_WRITE_FAILED".to_string())?;
    fs::write(&temporary, bytes).map_err(|_| "DEVICE_STORE_WRITE_FAILED".to_string())?;
    fs::rename(temporary, path).map_err(|_| "DEVICE_STORE_WRITE_FAILED".to_string())
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.len() > 256
        || !key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ":_-".contains(character))
    {
        return Err("DEVICE_STORE_KEY_INVALID".to_string());
    }
    Ok(())
}

fn load_or_create_encryption_key(secrets: &dyn SecretStore) -> Result<[u8; 32], String> {
    if let Some(encoded) = secrets.get(RESULT_SYNC_KEY_ACCOUNT)? {
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| "DEVICE_STORE_KEY_INVALID".to_string())?;
        return bytes
            .try_into()
            .map_err(|_| "DEVICE_STORE_KEY_INVALID".to_string());
    }
    let mut key = [0_u8; 32];
    SystemRandom::new()
        .fill(&mut key)
        .map_err(|_| "DEVICE_STORE_RANDOM_FAILED".to_string())?;
    secrets.set(RESULT_SYNC_KEY_ACCOUNT, &STANDARD.encode(key))?;
    Ok(key)
}

pub fn get_value(
    path: &Path,
    secrets: &dyn SecretStore,
    key: &str,
    encrypted: bool,
) -> Result<Option<String>, String> {
    validate_key(key)?;
    let Some(value) = load_values(path)?.remove(key) else {
        return Ok(None);
    };
    if encrypted {
        return decrypt_queue_value(&load_or_create_encryption_key(secrets)?, &value).map(Some);
    }
    Ok(Some(value))
}

pub fn set_value(
    path: &Path,
    secrets: &dyn SecretStore,
    key: &str,
    value: &str,
    encrypted: bool,
) -> Result<(), String> {
    validate_key(key)?;
    if value.len() > DEVICE_VALUE_LIMIT {
        return Err("DEVICE_STORE_VALUE_TOO_LARGE".to_string());
    }
    let mut values = load_values(path)?;
    let persisted = if encrypted {
        encrypt_queue_value(&load_or_create_encryption_key(secrets)?, value)?
    } else {
        value.to_string()
    };
    values.insert(key.to_string(), persisted);
    save_values(path, &values)
}

pub fn delete_value(path: &Path, key: &str) -> Result<(), String> {
    validate_key(key)?;
    let mut values = load_values(path)?;
    if values.remove(key).is_some() {
        save_values(path, &values)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{decrypt_queue_value, encrypt_queue_value};

    #[test]
    fn pending_sync_payload_is_encrypted_at_rest_and_round_trips() {
        let key = [7_u8; 32];
        let plaintext = r#"{"generationUuid":"gen-1","output":"敏感结果"}"#;

        let encrypted = encrypt_queue_value(&key, plaintext).unwrap();

        assert!(!encrypted.contains("敏感结果"));
        assert_eq!(decrypt_queue_value(&key, &encrypted).unwrap(), plaintext);
    }

    #[test]
    fn decrypt_rejects_tampered_pending_sync_payload() {
        let key = [9_u8; 32];
        let encrypted = encrypt_queue_value(&key, "queued output").unwrap();
        let mut tampered = encrypted.into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'A' { b'B' } else { b'A' };

        assert!(decrypt_queue_value(&key, &String::from_utf8(tampered).unwrap()).is_err());
    }
}
