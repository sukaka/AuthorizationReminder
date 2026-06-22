use juxin_ai_assistant_lib::build_mode::BuildMode;
use juxin_ai_assistant_lib::local_binding::validate_binding_base_url;
use juxin_ai_assistant_lib::server_config::ServerOrigin;

#[test]
fn lan_test_accepts_only_loopback_and_rfc1918_http() {
    for allowed in [
        "http://localhost:5193",
        "http://127.8.9.10:5193",
        "http://10.2.3.4:5193",
        "http://172.16.0.1:5193",
        "http://172.31.255.254:5193",
        "http://192.168.20.15:5193",
    ] {
        assert!(
            ServerOrigin::parse_for_mode(allowed, BuildMode::LanTest).is_ok(),
            "{allowed}"
        );
    }
    for rejected in [
        "http://172.32.0.1:5193",
        "http://100.64.0.1:5193",
        "http://169.254.1.1:5193",
        "http://8.8.8.8:5193",
        "http://127.1:5193",
        "http://2130706433:5193",
        "http://0x7f000001:5193",
        "http://intranet.local:5193",
        "http://192.168.1.20:5193/path",
        "http://user@192.168.1.20:5193",
        "http://192.168.1.20:5193?tenant=one",
        "http://192.168.1.20:5193#fragment",
        "http://*.example.com:5193",
    ] {
        assert!(
            ServerOrigin::parse_for_mode(rejected, BuildMode::LanTest).is_err(),
            "{rejected}"
        );
    }
}

#[test]
fn production_rejects_every_http_origin_even_in_debug_tests() {
    for raw in [
        "http://localhost:5193",
        "http://127.0.0.1:5193",
        "http://10.2.3.4:5193",
        "http://172.16.0.1:5193",
        "http://192.168.1.20:5193",
    ] {
        assert!(
            ServerOrigin::parse_for_mode(raw, BuildMode::Production).is_err(),
            "{raw}"
        );
    }
}

#[test]
fn all_modes_accept_exact_https_origins() {
    for mode in [
        BuildMode::Development,
        BuildMode::LanTest,
        BuildMode::Production,
    ] {
        assert!(
            ServerOrigin::parse_for_mode("https://ai.example.com", mode).is_ok(),
            "{mode:?}"
        );
    }
}

#[test]
fn local_binding_uses_the_same_build_mode_policy() {
    assert!(validate_binding_base_url("http://192.168.20.15:5193", BuildMode::LanTest).is_ok());
    assert!(validate_binding_base_url("http://192.168.20.15:5193", BuildMode::Production).is_err());
}
