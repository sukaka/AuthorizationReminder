pub trait SecretStore: Send + Sync {
    fn set(&self, profile_id: &str, secret: &str) -> Result<(), String>;
    fn get(&self, profile_id: &str) -> Result<Option<String>, String>;
    fn delete(&self, profile_id: &str) -> Result<(), String>;
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
