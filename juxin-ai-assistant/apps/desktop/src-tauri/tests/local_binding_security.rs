use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use juxin_ai_assistant_lib::local_binding::{
    validate_binding_base_url, verify_binding_token, LocalUserSession,
};

#[test]
fn binding_url_requires_https_except_explicit_loopback_development() {
    // Given/When/Then: production accepts one exact HTTPS origin only.
    assert!(validate_binding_base_url("https://ai.example.com", false).is_ok());
    assert!(validate_binding_base_url("http://ai.example.com", false).is_err());
    assert!(validate_binding_base_url("https://user@ai.example.com", false).is_err());
    assert!(validate_binding_base_url("https://ai.example.com/path", false).is_err());

    // Given/When/Then: loopback HTTP is an explicit development-only exception.
    assert!(validate_binding_base_url("http://127.0.0.1:18093", true).is_ok());
    assert!(validate_binding_base_url("http://127.0.0.1:18093", false).is_err());
}

#[tokio::test]
async fn native_verifier_posts_token_to_fixed_verify_path() {
    // Given: a loopback development server standing in for the configured origin.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let captured = Arc::new(Mutex::new(String::new()));
    let request_capture = Arc::clone(&captured);
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0_u8; 4096];
        let count = stream.read(&mut bytes).unwrap();
        *request_capture.lock().unwrap() = String::from_utf8_lossy(&bytes[..count]).to_string();
        let body = r#"{"user_id":"verified-user"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body,
        );
        stream.write_all(response.as_bytes()).unwrap();
    });
    let base_url = validate_binding_base_url(&format!("http://{address}"), true).unwrap();

    // When: native validates a renderer-provided binding token.
    let user_id = verify_binding_token(&base_url, "signed-token")
        .await
        .unwrap();
    server.join().unwrap();

    // Then: the endpoint is fixed by native and the response establishes identity.
    let request = captured.lock().unwrap();
    assert!(request.starts_with("POST /api/ai/local-binding/verify HTTP/1.1"));
    assert!(request.contains(r#"{"token":"signed-token"}"#));
    assert_eq!(user_id, "verified-user");
}

#[test]
fn verified_identity_switch_logs_out_previous_user_before_binding() {
    // Given: a process already bound through a verified token.
    let session = LocalUserSession::default();
    session.bind_verified("user-one", |_| Ok(())).unwrap();
    let cleaned = Mutex::new(Vec::<String>::new());

    // When: a different verified token is bound in the same process.
    session
        .bind_verified("user-two", |previous| {
            cleaned.lock().unwrap().push(previous.to_string());
            Ok(())
        })
        .unwrap();

    // Then: prior cleanup happened and only the verified replacement is authorized.
    assert_eq!(*cleaned.lock().unwrap(), vec!["user-one"]);
    assert!(session.authorize("user-one").is_err());
    assert!(session.authorize("user-two").is_ok());
}

#[test]
fn current_user_id_is_available_for_origin_switch_cleanup() {
    let session = LocalUserSession::default();
    assert_eq!(session.current_user_id().unwrap(), None);

    session.bind_verified("user-1", |_| Ok(())).unwrap();

    assert_eq!(
        session.current_user_id().unwrap(),
        Some("user-1".to_string())
    );
}

#[test]
fn failed_previous_user_cleanup_preserves_existing_binding() {
    // Given: an existing verified binding.
    let session = LocalUserSession::default();
    session.bind_verified("user-one", |_| Ok(())).unwrap();

    // When: logout cleanup fails during a verified user switch.
    let result = session.bind_verified("user-two", |_| Err("TEST_LOGOUT_FAILED".to_string()));

    // Then: the new user is not installed over the previous identity.
    assert_eq!(result.unwrap_err(), "TEST_LOGOUT_FAILED");
    assert!(session.authorize("user-one").is_ok());
    assert!(session.authorize("user-two").is_err());
}

#[test]
fn logout_unbinds_only_after_cleanup_succeeds() {
    // Given: a verified local binding.
    let session = LocalUserSession::default();
    session.bind_verified("user-one", |_| Ok(())).unwrap();

    // When: native logout cleanup succeeds.
    session.logout("user-one", |_| Ok(())).unwrap();

    // Then: the process accepts a later verified identity, but no raw id is authorized now.
    assert!(session.authorize("user-one").is_err());
    session.bind_verified("user-two", |_| Ok(())).unwrap();
    assert!(session.authorize("user-two").is_ok());
}
