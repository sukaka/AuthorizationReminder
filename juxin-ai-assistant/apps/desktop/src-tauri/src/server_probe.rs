use std::error::Error as StdError;
use std::net::IpAddr;
use std::sync::OnceLock;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::redirect::Policy;
use serde::Deserialize;
use thiserror::Error;
use tokio::{net::lookup_host, time::timeout};
use url::{Host, Url};

use crate::server_config::{raw_authority_has_userinfo, ServerOrigin};

const PRODUCT: &str = "juxin-ai-assistant";
const PROTOCOL_VERSION: u64 = 1;
const MAX_RESPONSE_BYTES: usize = 16 * 1024;
static NATIVE_ROOT_CERTIFICATES: OnceLock<Vec<reqwest::Certificate>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProbeFailureKind {
    Dns,
    Timeout,
    Tls,
    Connection,
    HttpStatus,
    ResponseTooLarge,
    InvalidResponse,
    ProductMismatch,
    ProtocolIncompatible,
    UnsafeAuthPortal,
    InvalidTimeouts,
}

#[derive(Debug, Error)]
pub enum ProbeError {
    #[error("域名解析失败")]
    Dns,
    #[error("连接超时")]
    Timeout,
    #[error("TLS 或证书校验失败")]
    Tls,
    #[error("无法连接远程服务")]
    Connection,
    #[error("远程服务返回 HTTP {0}")]
    HttpStatus(u16),
    #[error("远程服务响应超过大小限制")]
    ResponseTooLarge,
    #[error("远程服务响应格式无效")]
    InvalidResponse,
    #[error("远程服务产品不匹配")]
    ProductMismatch,
    #[error("远程服务协议版本不兼容")]
    ProtocolIncompatible,
    #[error("统一登录门户地址不安全")]
    UnsafeAuthPortal,
    #[error("连接和总超时配置无效")]
    InvalidTimeouts,
}

impl ProbeError {
    pub const fn kind(&self) -> ProbeFailureKind {
        match self {
            Self::Dns => ProbeFailureKind::Dns,
            Self::Timeout => ProbeFailureKind::Timeout,
            Self::Tls => ProbeFailureKind::Tls,
            Self::Connection => ProbeFailureKind::Connection,
            Self::HttpStatus(_) => ProbeFailureKind::HttpStatus,
            Self::ResponseTooLarge => ProbeFailureKind::ResponseTooLarge,
            Self::InvalidResponse => ProbeFailureKind::InvalidResponse,
            Self::ProductMismatch => ProbeFailureKind::ProductMismatch,
            Self::ProtocolIncompatible => ProbeFailureKind::ProtocolIncompatible,
            Self::UnsafeAuthPortal => ProbeFailureKind::UnsafeAuthPortal,
            Self::InvalidTimeouts => ProbeFailureKind::InvalidTimeouts,
        }
    }
}

#[derive(Debug)]
pub struct ProbeSuccess {
    auth_portal_url: Url,
}

impl ProbeSuccess {
    pub const fn auth_portal_url(&self) -> &Url {
        &self.auth_portal_url
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapContract {
    product: String,
    protocol_version: u64,
    auth_portal_url: String,
}

#[derive(Debug)]
pub struct DesktopProbe {
    connect_timeout: Duration,
    total_timeout: Duration,
    native_root_certificates: Vec<reqwest::Certificate>,
}

impl DesktopProbe {
    pub fn new() -> Result<Self, ProbeError> {
        Self::with_timeouts(Duration::from_secs(5), Duration::from_secs(10))
    }

    pub fn with_timeouts(
        connect_timeout: Duration,
        total_timeout: Duration,
    ) -> Result<Self, ProbeError> {
        if connect_timeout.is_zero() || total_timeout.is_zero() || connect_timeout > total_timeout {
            return Err(ProbeError::InvalidTimeouts);
        }
        let native_root_certificates = NATIVE_ROOT_CERTIFICATES
            .get_or_init(|| {
                rustls_native_certs::load_native_certs()
                    .certs
                    .into_iter()
                    .filter_map(|certificate| {
                        reqwest::Certificate::from_der(certificate.as_ref()).ok()
                    })
                    .collect()
            })
            .clone();
        if native_root_certificates.is_empty() {
            return Err(ProbeError::Tls);
        }
        Ok(Self {
            connect_timeout,
            total_timeout,
            native_root_certificates,
        })
    }

    pub async fn probe(&self, origin: &ServerOrigin) -> Result<ProbeSuccess, ProbeError> {
        timeout(self.total_timeout, self.probe_inner(origin))
            .await
            .map_err(|_| ProbeError::Timeout)?
    }

    async fn probe_inner(&self, origin: &ServerOrigin) -> Result<ProbeSuccess, ProbeError> {
        let client = self.client_for(origin).await?;
        let response = client
            .get(origin.endpoint()?)
            .send()
            .await
            .map_err(classify_transport_error)?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(ProbeError::HttpStatus(response.status().as_u16()));
        }
        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(classify_transport_error)?;
            if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err(ProbeError::ResponseTooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        validate_contract(&body, cfg!(debug_assertions) && origin.is_loopback_http())
    }

    async fn client_for(&self, origin: &ServerOrigin) -> Result<reqwest::Client, ProbeError> {
        let mut builder = reqwest::Client::builder()
            .connect_timeout(self.connect_timeout)
            .timeout(self.total_timeout)
            .redirect(Policy::none())
            .tls_built_in_native_certs(false)
            .no_proxy();
        for certificate in &self.native_root_certificates {
            builder = builder.add_root_certificate(certificate.clone());
        }
        if let Some(Host::Domain(domain)) = origin.url().host() {
            if !domain.eq_ignore_ascii_case("localhost") {
                let port = origin
                    .url()
                    .port_or_known_default()
                    .ok_or(ProbeError::Dns)?;
                let addresses = timeout(self.connect_timeout, lookup_host((domain, port)))
                    .await
                    .map_err(|_| ProbeError::Dns)?
                    .map_err(|_| ProbeError::Dns)?
                    .collect::<Vec<_>>();
                if addresses.is_empty() {
                    return Err(ProbeError::Dns);
                }
                builder = builder.resolve_to_addrs(domain, &addresses);
            }
        }
        builder.build().map_err(|_| ProbeError::Connection)
    }
}

fn validate_contract(
    body: &[u8],
    allow_loopback_http_portal: bool,
) -> Result<ProbeSuccess, ProbeError> {
    let contract: BootstrapContract =
        serde_json::from_slice(body).map_err(|_| ProbeError::InvalidResponse)?;
    if contract.product != PRODUCT {
        return Err(ProbeError::ProductMismatch);
    }
    if contract.protocol_version != PROTOCOL_VERSION {
        return Err(ProbeError::ProtocolIncompatible);
    }
    let auth_portal_url =
        Url::parse(&contract.auth_portal_url).map_err(|_| ProbeError::UnsafeAuthPortal)?;
    let safe_scheme = auth_portal_url.scheme() == "https"
        || (auth_portal_url.scheme() == "http"
            && allow_loopback_http_portal
            && is_loopback(&auth_portal_url));
    let safe_portal = safe_scheme
        && auth_portal_url.host().is_some()
        && auth_portal_url.username().is_empty()
        && auth_portal_url.password().is_none()
        && auth_portal_url.fragment().is_none()
        && !raw_authority_has_userinfo(&contract.auth_portal_url)
        && !contract.auth_portal_url.contains('*');
    if !safe_portal {
        return Err(ProbeError::UnsafeAuthPortal);
    }
    Ok(ProbeSuccess { auth_portal_url })
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => IpAddr::V4(address).is_loopback(),
        Some(Host::Ipv6(address)) => IpAddr::V6(address).is_loopback(),
        None => false,
    }
}

fn classify_transport_error(error: reqwest::Error) -> ProbeError {
    if error.is_timeout() {
        return ProbeError::Timeout;
    }
    let mut details = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        if cause.downcast_ref::<rustls::Error>().is_some() {
            return ProbeError::Tls;
        }
        details.push(' ');
        details.push_str(&cause.to_string());
        source = cause.source();
    }
    let details = details.to_ascii_lowercase();
    if details.contains("tls")
        || details.contains("certificate")
        || details.contains("ssl")
        || details.contains("corrupt message")
        || details.contains("invalidcontenttype")
    {
        ProbeError::Tls
    } else {
        ProbeError::Connection
    }
}
