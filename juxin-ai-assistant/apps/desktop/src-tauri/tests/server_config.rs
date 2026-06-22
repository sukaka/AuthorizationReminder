use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use chrono::{TimeZone, Utc};
use juxin_ai_assistant_lib::server_config::{
    default_server_config, load_server_config, save_server_config, DesktopProbe, ProbeFailureKind,
    ServerConfig, ServerConfigError, ServerOrigin,
};

fn serve_once(
    status: &'static str,
    body: String,
    delay: Duration,
) -> (String, thread::JoinHandle<()>, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (request_sender, request_receiver) = mpsc::channel();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0_u8; 2048];
        let request_length = stream.read(&mut request).unwrap();
        let _ =
            request_sender.send(String::from_utf8_lossy(&request[..request_length]).into_owned());
        thread::sleep(delay);
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
    });
    (format!("http://{address}"), handle, request_receiver)
}

#[test]
fn production_origin_rejects_untrusted_url_components() {
    for raw in [
        "http://ai.example.com",
        "https://ai.example.com/path",
        "https://ai.example.com?tenant=one",
        "https://ai.example.com/#fragment",
        "https://user:pass@ai.example.com",
        "https://@ai.example.com",
        "https://ai.example.com/%2e",
        "https://ai.example.com/a/..",
        "https://*.example.com",
    ] {
        assert!(ServerOrigin::parse_production(raw).is_err(), "{raw}");
    }
}

#[test]
fn production_origin_normalizes_host_default_port_and_trailing_slash() {
    let origin = ServerOrigin::parse_production("https://AI.Example.com:443/").unwrap();

    assert_eq!(origin.as_str(), "https://ai.example.com");
}

#[test]
fn optional_default_server_prefills_only_a_production_https_origin() {
    let config = default_server_config(Some("https://AI.Example.com:443/"))
        .unwrap()
        .unwrap();

    assert_eq!(config.server_origin().as_str(), "https://ai.example.com");
    assert_eq!(default_server_config(None).unwrap(), None);
    assert!(default_server_config(Some("http://ai.example.com")).is_err());
}

#[test]
fn development_origin_allows_only_loopback_http() {
    for raw in [
        "http://localhost:18093",
        "http://127.0.0.1:18093",
        "http://[::1]:18093",
    ] {
        assert!(ServerOrigin::parse(raw).is_ok(), "{raw}");
    }

    assert!(ServerOrigin::parse("http://192.168.1.8:18093").is_err());
}

#[test]
fn development_ipv6_loopback_normalizes_to_capability_safe_localhost() {
    let origin = ServerOrigin::parse("http://[::1]:18093").unwrap();

    assert_eq!(origin.as_str(), "http://localhost:18093");
}

#[test]
fn probe_rejects_invalid_timeout_budgets() {
    assert_eq!(
        DesktopProbe::with_timeouts(Duration::ZERO, Duration::from_secs(1))
            .unwrap_err()
            .kind(),
        ProbeFailureKind::InvalidTimeouts
    );
    assert_eq!(
        DesktopProbe::with_timeouts(Duration::from_secs(2), Duration::from_secs(1))
            .unwrap_err()
            .kind(),
        ProbeFailureKind::InvalidTimeouts
    );
}

#[test]
fn server_config_round_trips_versioned_json() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("desktop-server.json");
    let checked_at = Utc.with_ymd_and_hms(2026, 6, 21, 1, 30, 0).unwrap();
    let config = ServerConfig::new(
        ServerOrigin::parse_production("https://ai.example.com").unwrap(),
        Some(checked_at),
    );

    save_server_config(&path, &config).unwrap();
    let restored = load_server_config(&path).unwrap().unwrap();
    let raw = fs::read_to_string(path).unwrap();

    assert_eq!(restored, config);
    assert!(raw.contains("\"schemaVersion\": 1"));
    assert!(raw.contains("\"serverOrigin\": \"https://ai.example.com\""));
    assert!(raw.contains("\"lastSuccessfulCheckAt\""));
}

#[test]
fn saving_server_config_replaces_the_previous_version() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("desktop-server.json");
    let first = ServerConfig::new(
        ServerOrigin::parse_production("https://first.example.com").unwrap(),
        None,
    );
    let second = ServerConfig::new(
        ServerOrigin::parse_production("https://second.example.com").unwrap(),
        None,
    );

    save_server_config(&path, &first).unwrap();
    save_server_config(&path, &second).unwrap();
    let restored = load_server_config(&path).unwrap().unwrap();

    assert_eq!(
        restored.server_origin().as_str(),
        "https://second.example.com"
    );
}

#[test]
fn corrupted_server_config_is_reported_without_overwrite() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("desktop-server.json");
    fs::write(&path, b"{not-json").unwrap();

    let error = load_server_config(&path).unwrap_err();

    assert_eq!(error, ServerConfigError::InvalidFormat);
    assert_eq!(fs::read(path).unwrap(), b"{not-json");
}

#[test]
fn unsupported_server_config_schema_is_rejected() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("desktop-server.json");
    fs::write(
        &path,
        br#"{"schemaVersion":2,"serverOrigin":"https://ai.example.com","lastSuccessfulCheckAt":null}"#,
    )
    .unwrap();

    let error = load_server_config(&path).unwrap_err();

    assert_eq!(error, ServerConfigError::UnsupportedSchema);
}

#[tokio::test]
async fn probe_accepts_supported_desktop_contract() {
    let body = serde_json::json!({
        "product": "juxin-ai-assistant",
        "protocolVersion": 1,
        "authPortalUrl": "https://auth.example.test/portal?system=ai-assistant"
    })
    .to_string();
    let (base_url, server, request) = serve_once("200 OK", body, Duration::ZERO);
    let origin = ServerOrigin::parse(&base_url).unwrap();

    let result = DesktopProbe::new().unwrap().probe(&origin).await.unwrap();
    server.join().unwrap();
    let request = request.recv().unwrap();

    assert_eq!(
        result.auth_portal_url().as_str(),
        "https://auth.example.test/portal?system=ai-assistant"
    );
    assert!(request.starts_with("GET /api/ai/desktop/bootstrap HTTP/1.1\r\n"));
    assert!(!request.to_ascii_lowercase().contains("\r\ncookie:"));
}

#[tokio::test]
async fn debug_probe_accepts_loopback_http_auth_portal() {
    let body = serde_json::json!({
        "product": "juxin-ai-assistant",
        "protocolVersion": 1,
        "authPortalUrl": "http://127.0.0.1:5180/portal?system=ai-assistant"
    })
    .to_string();
    let (base_url, server, _) = serve_once("200 OK", body, Duration::ZERO);
    let origin = ServerOrigin::parse(&base_url).unwrap();

    let result = DesktopProbe::new().unwrap().probe(&origin).await.unwrap();
    server.join().unwrap();

    assert_eq!(
        result.auth_portal_url().as_str(),
        "http://127.0.0.1:5180/portal?system=ai-assistant"
    );
}

#[tokio::test]
async fn probe_classifies_contract_and_http_failures() {
    let cases = [
        (
            "201 Created",
            serde_json::json!({
                "product": "juxin-ai-assistant",
                "protocolVersion": 1,
                "authPortalUrl": "https://auth.example.test/portal"
            })
            .to_string(),
            ProbeFailureKind::HttpStatus,
        ),
        (
            "200 OK",
            serde_json::json!({
                "product": "another-product",
                "protocolVersion": 1,
                "authPortalUrl": "https://auth.example.test/portal"
            })
            .to_string(),
            ProbeFailureKind::ProductMismatch,
        ),
        (
            "200 OK",
            serde_json::json!({
                "product": "juxin-ai-assistant",
                "protocolVersion": 2,
                "authPortalUrl": "https://auth.example.test/portal"
            })
            .to_string(),
            ProbeFailureKind::ProtocolIncompatible,
        ),
        (
            "200 OK",
            serde_json::json!({
                "product": "juxin-ai-assistant",
                "protocolVersion": 70_000,
                "authPortalUrl": "https://auth.example.test/portal"
            })
            .to_string(),
            ProbeFailureKind::ProtocolIncompatible,
        ),
        (
            "200 OK",
            serde_json::json!({
                "product": "juxin-ai-assistant",
                "protocolVersion": 1,
                "authPortalUrl": "http://auth.example.test/portal"
            })
            .to_string(),
            ProbeFailureKind::UnsafeAuthPortal,
        ),
        (
            "200 OK",
            serde_json::json!({
                "product": "juxin-ai-assistant",
                "protocolVersion": 1,
                "authPortalUrl": "https://@auth.example.test/portal"
            })
            .to_string(),
            ProbeFailureKind::UnsafeAuthPortal,
        ),
        (
            "503 Service Unavailable",
            "{}".to_string(),
            ProbeFailureKind::HttpStatus,
        ),
    ];

    for (status, body, expected) in cases {
        let (base_url, server, _) = serve_once(status, body, Duration::ZERO);
        let origin = ServerOrigin::parse(&base_url).unwrap();

        let error = DesktopProbe::new()
            .unwrap()
            .probe(&origin)
            .await
            .unwrap_err();
        server.join().unwrap();

        assert_eq!(error.kind(), expected);
    }
}

#[tokio::test]
async fn probe_does_not_follow_redirects() {
    let (base_url, server, _) = serve_once(
        "302 Found\r\nLocation: https://other.example.test/bootstrap",
        String::new(),
        Duration::ZERO,
    );
    let origin = ServerOrigin::parse(&base_url).unwrap();

    let error = DesktopProbe::new()
        .unwrap()
        .probe(&origin)
        .await
        .unwrap_err();
    server.join().unwrap();

    assert_eq!(error.kind(), ProbeFailureKind::HttpStatus);
}

#[tokio::test]
async fn probe_rejects_responses_larger_than_sixteen_kibibytes() {
    let body = serde_json::json!({
        "product": "juxin-ai-assistant",
        "protocolVersion": 1,
        "authPortalUrl": format!("https://auth.example.test/{}", "a".repeat(17_000))
    })
    .to_string();
    let (base_url, server, _) = serve_once("200 OK", body, Duration::ZERO);
    let origin = ServerOrigin::parse(&base_url).unwrap();

    let error = DesktopProbe::new()
        .unwrap()
        .probe(&origin)
        .await
        .unwrap_err();
    server.join().unwrap();

    assert_eq!(error.kind(), ProbeFailureKind::ResponseTooLarge);
}

#[tokio::test]
async fn probe_classifies_total_timeout() {
    let body = serde_json::json!({
        "product": "juxin-ai-assistant",
        "protocolVersion": 1,
        "authPortalUrl": "https://auth.example.test/portal"
    })
    .to_string();
    let (base_url, server, _) = serve_once("200 OK", body, Duration::from_millis(100));
    let origin = ServerOrigin::parse(&base_url).unwrap();
    let probe =
        DesktopProbe::with_timeouts(Duration::from_millis(20), Duration::from_millis(30)).unwrap();

    let error = probe.probe(&origin).await.unwrap_err();
    server.join().unwrap();

    assert_eq!(error.kind(), ProbeFailureKind::Timeout);
}

#[tokio::test]
async fn probe_classifies_dns_failure() {
    let invalid_dns_name = format!("https://{}.invalid", "a".repeat(64));
    let origin = ServerOrigin::parse_production(&invalid_dns_name).unwrap();
    let probe =
        DesktopProbe::with_timeouts(Duration::from_secs(1), Duration::from_secs(2)).unwrap();

    let error = probe.probe(&origin).await.unwrap_err();

    assert_eq!(error.kind(), ProbeFailureKind::Dns);
}

#[tokio::test]
async fn probe_classifies_tls_failure() {
    let (base_url, server, _) = serve_once("200 OK", "{}".to_string(), Duration::ZERO);
    let tls_url = base_url.replacen("http://", "https://", 1);
    let origin = ServerOrigin::parse_production(&tls_url).unwrap();

    let error = DesktopProbe::new()
        .unwrap()
        .probe(&origin)
        .await
        .unwrap_err();
    server.join().unwrap();

    assert_eq!(error.kind(), ProbeFailureKind::Tls);
}

#[tokio::test]
async fn probe_classifies_connection_refusal() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let origin = ServerOrigin::parse(&format!("http://{address}")).unwrap();

    let error = DesktopProbe::new()
        .unwrap()
        .probe(&origin)
        .await
        .unwrap_err();

    assert_eq!(error.kind(), ProbeFailureKind::Connection);
}
