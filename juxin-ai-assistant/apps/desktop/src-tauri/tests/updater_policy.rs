use juxin_ai_assistant_lib::updater_policy::{UpdaterPolicy, UpdaterPolicyError};

#[test]
fn business_server_cannot_override_update_trust() {
    // Given: updater trust is fixed by release-build inputs.
    let policy = UpdaterPolicy::from_build(
        Some("true"),
        Some("https://updates.example.com/latest.json"),
        Some("trusted-public-key"),
    )
    .unwrap();

    // When / Then: runtime callers can only observe the fixed endpoint and key.
    assert_eq!(
        policy.endpoint().map(url::Url::as_str),
        Some("https://updates.example.com/latest.json")
    );
    assert_eq!(policy.public_key(), Some("trusted-public-key"));
}

#[test]
fn updater_is_disabled_without_complete_signed_configuration() {
    // Given: the default build has no updater environment values.
    // When: the runtime policy is resolved.
    let policy = UpdaterPolicy::from_build(None, None, None).unwrap();

    // Then: no runtime update request is allowed.
    assert!(!policy.enabled());
    assert!(!policy.may_request_updates());
}

#[test]
fn updater_requires_https_endpoint_and_public_key() {
    // Given: update checks were explicitly enabled with an insecure endpoint.
    // When: the build policy is resolved.
    let result = UpdaterPolicy::from_build(
        Some("true"),
        Some("http://updates.example.com/latest.json"),
        Some("public-key"),
    );

    // Then: malformed signed-update configuration prevents startup.
    assert_eq!(
        result.unwrap_err(),
        UpdaterPolicyError::SecureEndpointRequired
    );
}

#[test]
fn updater_enables_only_with_all_three_conditions() {
    // Given: enablement, an exact HTTPS endpoint and a signing public key.
    // When: the build policy is resolved.
    let policy = UpdaterPolicy::from_build(
        Some("true"),
        Some("https://updates.example.com/juxin/latest.json"),
        Some("public-key"),
    )
    .unwrap();

    // Then: an explicit check may use the configured endpoint.
    assert!(policy.enabled());
    assert!(policy.may_request_updates());
    assert_eq!(
        policy.endpoint().map(url::Url::as_str),
        Some("https://updates.example.com/juxin/latest.json")
    );
}

#[test]
fn updater_rejects_credentials_and_wildcards() {
    for endpoint in [
        "https://user:pass@updates.example.com/latest.json",
        "https://*/latest.json",
    ] {
        // Given: an enabled updater with an unsafe endpoint.
        // When / Then: unsafe endpoint syntax is rejected before Tauri starts.
        assert!(
            UpdaterPolicy::from_build(Some("true"), Some(endpoint), Some("public-key")).is_err()
        );
    }
}
