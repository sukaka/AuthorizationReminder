use std::net::Ipv4Addr;

use url::{Host, Url};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BuildMode {
    Development,
    LanTest,
    Production,
}

impl BuildMode {
    pub fn from_build() -> Self {
        match option_env!("AI_ASSISTANT_BUILD_MODE").unwrap_or("production") {
            "development" => Self::Development,
            "lan-test" => Self::LanTest,
            _ => Self::Production,
        }
    }

    pub const fn allows_private_http(self) -> bool {
        matches!(self, Self::Development | Self::LanTest)
    }

    pub fn allows_url(self, raw: &str, url: &Url) -> bool {
        url.scheme() == "https"
            || (url.scheme() == "http"
                && self.allows_private_http()
                && has_canonical_private_http_host(raw, url))
    }
}

impl From<bool> for BuildMode {
    fn from(allow_development_http: bool) -> Self {
        if allow_development_http {
            Self::Development
        } else {
            Self::Production
        }
    }
}

pub fn is_loopback_or_private_ipv4(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => is_allowed_ipv4(address),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

fn has_canonical_private_http_host(raw: &str, url: &Url) -> bool {
    let Some(host) = raw_authority_hostname(raw) else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") || host.eq_ignore_ascii_case("[::1]") {
        return true;
    }
    let Some(Host::Ipv4(parsed)) = url.host() else {
        return false;
    };
    host.parse::<Ipv4Addr>()
        .is_ok_and(|raw_address| raw_address == parsed && is_allowed_ipv4(raw_address))
}

fn raw_authority_hostname(raw: &str) -> Option<&str> {
    let (_, remainder) = raw.split_once("://")?;
    let authority_end = remainder.find(['/', '?', '#']).unwrap_or(remainder.len());
    let authority = &remainder[..authority_end];
    if authority.starts_with('[') {
        let closing_bracket = authority.find(']')?;
        return Some(&authority[..=closing_bracket]);
    }
    let port_separator = authority.rfind(':').unwrap_or(authority.len());
    Some(&authority[..port_separator])
}

fn is_allowed_ipv4(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    address.is_loopback()
        || octets[0] == 10
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 168)
}
