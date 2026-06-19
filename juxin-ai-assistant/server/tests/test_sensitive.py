from app.sensitive import SensitiveDetector


def test_detects_required_patterns_without_returning_raw_secret() -> None:
    detector = SensitiveDetector(confirm_signing_key=b"x" * 32)
    result = detector.scan(
        {
            "content": (
                "api_key=sk-private 13800138000 "
                "admin/password123 10.0.0.8"
            )
        }
    )

    assert {item.code for item in result.findings} >= {
        "API_KEY",
        "PHONE",
        "ACCOUNT_PASSWORD",
        "IPV4",
    }
    assert "sk-private" not in repr(result)
    assert "13800138000" not in repr(result)
    assert all(item.preview == "***" for item in result.findings)


def test_confirmation_digest_changes_when_input_changes() -> None:
    detector = SensitiveDetector(confirm_signing_key=b"x" * 32)
    first = detector.scan({"content": "token=one"})
    second = detector.scan({"content": "token=two"})

    assert first.confirmation_digest != second.confirmation_digest


def test_confirmation_only_accepts_digest_for_current_normalized_input() -> None:
    detector = SensitiveDetector(confirm_signing_key=b"x" * 32)
    result = detector.scan({"content": "13800138000"})

    assert detector.is_confirmed(result, result.confirmation_digest)
    assert not detector.is_confirmed(result, "0" * 64)
    assert not detector.is_confirmed(result, None)
