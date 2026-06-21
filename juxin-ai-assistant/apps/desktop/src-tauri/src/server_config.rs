use std::fs;
use std::io::Write;
use std::net::IpAddr;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use tempfile::NamedTempFile;
use thiserror::Error;
use url::{Host, Url};

pub use crate::server_probe::{DesktopProbe, ProbeError, ProbeFailureKind, ProbeSuccess};

const SCHEMA_VERSION: u8 = 1;
const BOOTSTRAP_PATH: &str = "/api/ai/desktop/bootstrap";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerOrigin(Url);

impl ServerOrigin {
    pub fn parse(raw: &str) -> Result<Self, ServerOriginError> {
        Self::parse_with_policy(raw, cfg!(debug_assertions))
    }

    pub fn parse_production(raw: &str) -> Result<Self, ServerOriginError> {
        Self::parse_with_policy(raw, false)
    }

    fn parse_with_policy(raw: &str, allow_loopback_http: bool) -> Result<Self, ServerOriginError> {
        let parsed = Url::parse(raw).map_err(|_| ServerOriginError::Invalid)?;
        let exact_origin = parsed.host().is_some()
            && parsed.username().is_empty()
            && parsed.password().is_none()
            && parsed.path() == "/"
            && parsed.query().is_none()
            && parsed.fragment().is_none()
            && raw_origin_path_is_empty(raw)
            && !raw_authority_has_userinfo(raw)
            && !raw.contains('*');
        if !exact_origin {
            return Err(ServerOriginError::Invalid);
        }
        let trusted_scheme = parsed.scheme() == "https"
            || (parsed.scheme() == "http" && allow_loopback_http && is_loopback(&parsed));
        if !trusted_scheme {
            return Err(ServerOriginError::Invalid);
        }
        let normalized = Url::parse(&parsed.origin().ascii_serialization())
            .map_err(|_| ServerOriginError::Invalid)?;
        Ok(Self(normalized))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str().trim_end_matches('/')
    }

    pub(crate) fn endpoint(&self) -> Result<Url, ProbeError> {
        self.0
            .join(BOOTSTRAP_PATH)
            .map_err(|_| ProbeError::InvalidResponse)
    }

    pub(crate) const fn url(&self) -> &Url {
        &self.0
    }

    pub(crate) fn is_loopback_http(&self) -> bool {
        self.0.scheme() == "http" && is_loopback(&self.0)
    }
}

impl Serialize for ServerOrigin {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ServerOrigin {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ServerOriginError {
    #[error("远程服务地址必须是安全的 Origin")]
    Invalid,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    schema_version: u8,
    server_origin: ServerOrigin,
    last_successful_check_at: Option<DateTime<Utc>>,
}

impl ServerConfig {
    pub const fn new(
        server_origin: ServerOrigin,
        last_successful_check_at: Option<DateTime<Utc>>,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            server_origin,
            last_successful_check_at,
        }
    }

    pub const fn server_origin(&self) -> &ServerOrigin {
        &self.server_origin
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ServerConfigError {
    #[error("无法读取桌面服务配置")]
    Read,
    #[error("桌面服务配置格式损坏")]
    InvalidFormat,
    #[error("桌面服务配置版本不受支持")]
    UnsupportedSchema,
    #[error("无法创建桌面配置目录")]
    CreateDirectory,
    #[error("无法写入桌面服务配置")]
    Write,
    #[error("无法提交桌面服务配置")]
    Persist,
}

pub fn load_server_config(path: &Path) -> Result<Option<ServerConfig>, ServerConfigError> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|_| ServerConfigError::Read)?;
    let config: ServerConfig =
        serde_json::from_slice(&bytes).map_err(|_| ServerConfigError::InvalidFormat)?;
    if config.schema_version != SCHEMA_VERSION {
        return Err(ServerConfigError::UnsupportedSchema);
    }
    Ok(Some(config))
}

pub fn save_server_config(path: &Path, config: &ServerConfig) -> Result<(), ServerConfigError> {
    let parent = path.parent().ok_or(ServerConfigError::CreateDirectory)?;
    fs::create_dir_all(parent).map_err(|_| ServerConfigError::CreateDirectory)?;
    let bytes = serde_json::to_vec_pretty(config).map_err(|_| ServerConfigError::InvalidFormat)?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|_| ServerConfigError::Write)?;
    temporary
        .write_all(&bytes)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| ServerConfigError::Write)?;
    temporary
        .persist(path)
        .map_err(|_| ServerConfigError::Persist)?;
    Ok(())
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => IpAddr::V4(address).is_loopback(),
        Some(Host::Ipv6(address)) => IpAddr::V6(address).is_loopback(),
        None => false,
    }
}

pub(crate) fn raw_authority_has_userinfo(raw: &str) -> bool {
    let Some((_, remainder)) = raw.split_once("://") else {
        return false;
    };
    let authority_end = remainder.find(['/', '?', '#']).unwrap_or(remainder.len());
    remainder[..authority_end].contains('@')
}

fn raw_origin_path_is_empty(raw: &str) -> bool {
    let Some((_, remainder)) = raw.split_once("://") else {
        return false;
    };
    match remainder.find(['/', '?', '#']) {
        None => true,
        Some(index) => &remainder[index..] == "/",
    }
}
