use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::digest;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};

pub trait SecretStore: Send + Sync {
    fn set(&self, profile_id: &str, secret: &str) -> Result<(), String>;
    fn get(&self, profile_id: &str) -> Result<Option<String>, String>;
    fn delete(&self, profile_id: &str) -> Result<(), String>;
}

const LOCAL_SECRET_KEY_FILE: &str = "secrets-vault.key";
const LOCAL_SECRET_VAULT_FILE: &str = "secrets-vault.json";
const LOCAL_SECRET_VERSION: u8 = 1;
const LOCAL_SECRET_AAD_PREFIX: &str = "com.juxin.ai-assistant:local-secret";

#[derive(Clone, Deserialize, Serialize)]
struct LocalSecretEnvelope {
    version: u8,
    nonce: String,
    ciphertext: String,
}

pub struct LocalEncryptedSecretStore {
    vault_path: PathBuf,
    key: [u8; 32],
    lock: Mutex<()>,
}

impl LocalEncryptedSecretStore {
    pub fn new(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|_| "无法创建本地密钥目录".to_string())?;
        Ok(Self {
            vault_path: root.join(LOCAL_SECRET_VAULT_FILE),
            key: load_or_create_local_secret_key(&root.join(LOCAL_SECRET_KEY_FILE))?,
            lock: Mutex::new(()),
        })
    }

    fn read_vault(&self) -> Result<BTreeMap<String, LocalSecretEnvelope>, String> {
        match fs::read_to_string(&self.vault_path) {
            Ok(raw) => serde_json::from_str(&raw).map_err(|_| "本地密钥文件已损坏".to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(_) => Err("无法读取本地密钥文件".to_string()),
        }
    }

    fn write_vault(&self, vault: &BTreeMap<String, LocalSecretEnvelope>) -> Result<(), String> {
        let raw = serde_json::to_vec_pretty(vault).map_err(|_| "无法序列化本地密钥".to_string())?;
        write_private_file(&self.vault_path, &raw).map_err(|_| "无法保存本地密钥文件".to_string())
    }
}

impl SecretStore for LocalEncryptedSecretStore {
    fn set(&self, profile_id: &str, secret: &str) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "本地密钥文件暂不可用".to_string())?;
        let mut vault = self.read_vault()?;
        vault.insert(
            hashed_secret_id(profile_id),
            encrypt_local_secret(&self.key, profile_id, secret)?,
        );
        self.write_vault(&vault)
    }

    fn get(&self, profile_id: &str) -> Result<Option<String>, String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "本地密钥文件暂不可用".to_string())?;
        let vault = self.read_vault()?;
        vault
            .get(&hashed_secret_id(profile_id))
            .map(|envelope| decrypt_local_secret(&self.key, profile_id, envelope))
            .transpose()
    }

    fn delete(&self, profile_id: &str) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "本地密钥文件暂不可用".to_string())?;
        let mut vault = self.read_vault()?;
        vault.remove(&hashed_secret_id(profile_id));
        self.write_vault(&vault)
    }
}

pub struct SystemKeychain;

impl SecretStore for SystemKeychain {
    fn set(&self, profile_id: &str, secret: &str) -> Result<(), String> {
        keyring::Entry::new("com.juxin.ai-assistant", profile_id)
            .map_err(|_| "无法打开系统钥匙串".to_string())?
            .set_password(secret)
            .map_err(|_| "无法保存模型密钥".to_string())
    }

    fn get(&self, profile_id: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new("com.juxin.ai-assistant", profile_id)
            .map_err(|_| "无法打开系统钥匙串".to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("无法读取模型密钥".to_string()),
        }
    }

    fn delete(&self, profile_id: &str) -> Result<(), String> {
        let entry = keyring::Entry::new("com.juxin.ai-assistant", profile_id)
            .map_err(|_| "无法打开系统钥匙串".to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("无法删除模型密钥".to_string()),
        }
    }
}

fn load_or_create_local_secret_key(path: &Path) -> Result<[u8; 32], String> {
    match fs::read_to_string(path) {
        Ok(encoded) => decode_local_secret_key(encoded.trim()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut key = [0_u8; 32];
            SystemRandom::new()
                .fill(&mut key)
                .map_err(|_| "无法生成本地加密密钥".to_string())?;
            write_private_file(path, STANDARD.encode(key).as_bytes())
                .map_err(|_| "无法保存本地加密密钥".to_string())?;
            Ok(key)
        }
        Err(_) => Err("无法读取本地加密密钥".to_string()),
    }
}

fn decode_local_secret_key(encoded: &str) -> Result<[u8; 32], String> {
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "本地加密密钥已损坏".to_string())?;
    bytes
        .try_into()
        .map_err(|_| "本地加密密钥已损坏".to_string())
}

fn encrypt_local_secret(
    key: &[u8; 32],
    profile_id: &str,
    secret: &str,
) -> Result<LocalSecretEnvelope, String> {
    let mut nonce = [0_u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "无法生成本地密钥随机数".to_string())?;
    let mut ciphertext = secret.as_bytes().to_vec();
    local_secret_cipher(key)?
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(local_secret_aad(profile_id).as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| "无法加密本地密钥".to_string())?;
    Ok(LocalSecretEnvelope {
        version: LOCAL_SECRET_VERSION,
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

fn decrypt_local_secret(
    key: &[u8; 32],
    profile_id: &str,
    envelope: &LocalSecretEnvelope,
) -> Result<String, String> {
    if envelope.version != LOCAL_SECRET_VERSION {
        return Err("本地密钥版本不受支持".to_string());
    }
    let nonce: [u8; NONCE_LEN] = STANDARD
        .decode(&envelope.nonce)
        .map_err(|_| "本地密钥文件已损坏".to_string())?
        .try_into()
        .map_err(|_| "本地密钥文件已损坏".to_string())?;
    let mut ciphertext = STANDARD
        .decode(&envelope.ciphertext)
        .map_err(|_| "本地密钥文件已损坏".to_string())?;
    let plaintext = local_secret_cipher(key)?
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(local_secret_aad(profile_id).as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| "无法解密本地密钥".to_string())?;
    String::from_utf8(plaintext.to_vec()).map_err(|_| "本地密钥文件已损坏".to_string())
}

fn local_secret_cipher(key: &[u8; 32]) -> Result<LessSafeKey, String> {
    UnboundKey::new(&AES_256_GCM, key)
        .map(LessSafeKey::new)
        .map_err(|_| "本地加密密钥不可用".to_string())
}

fn local_secret_aad(profile_id: &str) -> String {
    format!("{LOCAL_SECRET_AAD_PREFIX}:{profile_id}")
}

fn hashed_secret_id(profile_id: &str) -> String {
    URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, profile_id.as_bytes()).as_ref())
}

fn write_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes)?;
    set_private_permissions(&temporary)?;
    fs::rename(&temporary, path)?;
    set_private_permissions(path)
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{LocalEncryptedSecretStore, SecretStore};

    #[test]
    fn local_secret_store_encrypts_values_without_plaintext_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = LocalEncryptedSecretStore::new(dir.path()).unwrap();

        store.set("model-profile:one", "sk-local-secret").unwrap();

        assert_eq!(
            store.get("model-profile:one").unwrap().as_deref(),
            Some("sk-local-secret")
        );
        let vault = std::fs::read_to_string(dir.path().join("secrets-vault.json")).unwrap();
        assert!(!vault.contains("sk-local-secret"));
        assert!(!vault.contains("model-profile:one"));
    }

    #[test]
    fn local_secret_store_deletes_values() {
        let dir = tempfile::tempdir().unwrap();
        let store = LocalEncryptedSecretStore::new(dir.path()).unwrap();

        store.set("model-profile:one", "sk-local-secret").unwrap();
        store.delete("model-profile:one").unwrap();

        assert_eq!(store.get("model-profile:one").unwrap(), None);
    }
}
