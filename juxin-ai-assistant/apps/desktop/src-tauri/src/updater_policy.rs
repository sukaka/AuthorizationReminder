use thiserror::Error;
use url::Url;

#[derive(Clone, Debug)]
pub enum UpdaterPolicy {
    Disabled,
    Enabled { endpoint: Url, public_key: String },
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum UpdaterPolicyError {
    #[error("AI_UPDATER_ENABLED 只能为 true 或 false")]
    InvalidEnabledFlag,
    #[error("启用自动更新时必须提供 HTTPS 更新地址")]
    SecureEndpointRequired,
    #[error("启用自动更新时必须提供签名公钥")]
    PublicKeyRequired,
}

impl UpdaterPolicy {
    pub fn from_build(
        enabled: Option<&str>,
        endpoint: Option<&str>,
        public_key: Option<&str>,
    ) -> Result<Self, UpdaterPolicyError> {
        let enabled = match enabled {
            None | Some("") | Some("false") => false,
            Some("true") => true,
            Some(_) => return Err(UpdaterPolicyError::InvalidEnabledFlag),
        };
        if !enabled {
            return Ok(Self::Disabled);
        }
        let endpoint = endpoint
            .ok_or(UpdaterPolicyError::SecureEndpointRequired)
            .and_then(parse_endpoint)?;
        let public_key = public_key
            .filter(|value| !value.trim().is_empty())
            .ok_or(UpdaterPolicyError::PublicKeyRequired)?;
        Ok(Self::Enabled {
            endpoint,
            public_key: public_key.to_string(),
        })
    }

    pub const fn enabled(&self) -> bool {
        matches!(self, Self::Enabled { .. })
    }

    pub const fn may_request_updates(&self) -> bool {
        self.enabled()
    }

    pub const fn endpoint(&self) -> Option<&Url> {
        match self {
            Self::Disabled => None,
            Self::Enabled { endpoint, .. } => Some(endpoint),
        }
    }

    pub fn public_key(&self) -> Option<&str> {
        match self {
            Self::Disabled => None,
            Self::Enabled { public_key, .. } => Some(public_key),
        }
    }
}

fn parse_endpoint(raw: &str) -> Result<Url, UpdaterPolicyError> {
    let endpoint = Url::parse(raw).map_err(|_| UpdaterPolicyError::SecureEndpointRequired)?;
    let is_secure = endpoint.scheme() == "https"
        && endpoint.host_str().is_some()
        && endpoint.username().is_empty()
        && endpoint.password().is_none()
        && endpoint.fragment().is_none()
        && !endpoint.as_str().contains('*');
    if !is_secure {
        return Err(UpdaterPolicyError::SecureEndpointRequired);
    }
    Ok(endpoint)
}
