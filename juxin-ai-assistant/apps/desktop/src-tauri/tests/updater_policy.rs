use std::collections::HashMap;

use juxin_ai_assistant_lib::updater_policy::{UpdaterPolicy, UpdaterPolicyError};

#[test]
fn updater_is_disabled_without_complete_signed_configuration() {
    // Given: the default build has no updater environment values.
    // When: the runtime policy is resolved.
    let policy = UpdaterPolicy::from_env(|_| None).unwrap();

    // Then: no runtime update request is allowed.
    assert!(!policy.enabled());
    assert!(!policy.may_request_updates());
}

#[test]
fn updater_requires_https_endpoint_and_public_key() {
    // Given: update checks were explicitly enabled with an insecure endpoint.
    let values = HashMap::from([
        ("AI_UPDATER_ENABLED", "true"),
        ("UPDATER_URL", "http://updates.example.com/latest.json"),
        ("UPDATER_PUBLIC_KEY", "public-key"),
    ]);

    // When: the runtime policy is resolved.
    let result = UpdaterPolicy::from_env(|key| values.get(key).map(|value| (*value).to_string()));

    // Then: malformed signed-update configuration prevents startup.
    assert_eq!(
        result.unwrap_err(),
        UpdaterPolicyError::SecureEndpointRequired
    );
}

#[test]
fn updater_enables_only_with_all_three_conditions() {
    // Given: enablement, an exact HTTPS endpoint and a signing public key.
    let values = HashMap::from([
        ("AI_UPDATER_ENABLED", "true"),
        (
            "UPDATER_URL",
            "https://updates.example.com/juxin/latest.json",
        ),
        ("UPDATER_PUBLIC_KEY", "public-key"),
    ]);

    // When: the runtime policy is resolved.
    let policy =
        UpdaterPolicy::from_env(|key| values.get(key).map(|value| (*value).to_string())).unwrap();

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
        let values = HashMap::from([
            ("AI_UPDATER_ENABLED", "true"),
            ("UPDATER_URL", endpoint),
            ("UPDATER_PUBLIC_KEY", "public-key"),
        ]);

        // When / Then: unsafe endpoint syntax is rejected before Tauri starts.
        assert!(
            UpdaterPolicy::from_env(|key| values.get(key).map(|value| (*value).to_string()))
                .is_err()
        );
    }
}
