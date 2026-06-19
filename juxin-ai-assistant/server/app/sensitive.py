import base64
import hashlib
import hmac
import json
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Finding:
    code: str
    field: str
    start: int
    end: int
    preview: str = "***"


@dataclass(frozen=True)
class ScanResult:
    findings: list[Finding]
    confirmation_digest: str


RULES = {
    "PRIVATE_KEY": re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        re.IGNORECASE,
    ),
    "API_KEY": re.compile(
        r"\b(?:api[_-]?key|access[_-]?key|secret|token)\s*[:=]\s*\S+",
        re.IGNORECASE,
    ),
    "PHONE": re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    "ID_CARD": re.compile(r"(?<!\d)\d{17}[0-9Xx](?!\d)"),
    "EMAIL": re.compile(
        r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
        re.IGNORECASE,
    ),
    "IPV4": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    "URL": re.compile(r"https?://[^\s]+", re.IGNORECASE),
    "ACCOUNT_PASSWORD": re.compile(
        r"\b[\w.@+-]+\s*[/|,，]\s*"
        r"(?:password|passwd|pwd)?\s*[:=]?\s*\S+",
        re.IGNORECASE,
    ),
}


def derive_confirmation_key(encoded_content_key: str) -> bytes:
    normalized = encoded_content_key.strip()
    padded = normalized + ("=" * (-len(normalized) % 4))
    content_key = base64.urlsafe_b64decode(padded.encode("ascii"))
    if len(content_key) != 32:
        raise ValueError("内容加密密钥必须是 32 字节")
    return hmac.new(
        content_key,
        b"juxin-ai-sensitive-confirmation-v1",
        hashlib.sha256,
    ).digest()


class SensitiveDetector:
    def __init__(self, confirm_signing_key: bytes):
        if len(confirm_signing_key) < 32:
            raise ValueError("敏感确认签名密钥至少需要 32 字节")
        self._key = confirm_signing_key

    def scan(self, values: dict[str, object]) -> ScanResult:
        canonical = json.dumps(
            values,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        findings: list[Finding] = []
        for field, raw in values.items():
            text = json.dumps(raw, ensure_ascii=False) if isinstance(
                raw,
                (list, dict),
            ) else str(raw)
            for code, pattern in RULES.items():
                for match in pattern.finditer(text):
                    findings.append(
                        Finding(
                            code=code,
                            field=field,
                            start=match.start(),
                            end=match.end(),
                        )
                    )
        digest = hmac.new(
            self._key,
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return ScanResult(
            findings=findings,
            confirmation_digest=digest,
        )

    @staticmethod
    def is_confirmed(
        result: ScanResult,
        supplied_digest: str | None,
    ) -> bool:
        return bool(
            supplied_digest
            and hmac.compare_digest(
                result.confirmation_digest,
                supplied_digest,
            )
        )
