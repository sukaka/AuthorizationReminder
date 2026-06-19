use url::{Host, Url};

pub fn validate_base_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "模型地址格式无效".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("模型地址不能包含账号密码".to_string());
    }

    let loopback = matches!(url.host(), Some(Host::Domain("localhost")))
        || matches!(url.host(), Some(Host::Ipv4(ip)) if ip.is_loopback())
        || matches!(url.host(), Some(Host::Ipv6(ip)) if ip.is_loopback());

    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("公网模型地址必须使用 HTTPS".to_string());
    }

    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::validate_base_url;

    #[test]
    fn allows_https_and_loopback_http() {
        assert!(validate_base_url("https://api.example.com/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
    }

    #[test]
    fn rejects_public_http_and_credential_urls() {
        assert!(validate_base_url("http://api.example.com/v1").is_err());
        assert!(validate_base_url("https://user:pass@example.com/v1").is_err());
        assert!(validate_base_url("file:///tmp/key").is_err());
    }
}
