from __future__ import annotations

import re


SENSITIVE_MEMORY_PATTERN = re.compile(
    r"(api\s*key|apikey|token|secret|密码|口令|验证码|密钥|身份证|银行卡|sk-[A-Za-z0-9_-]{6,})",
    re.IGNORECASE,
)


def contains_sensitive_memory(value: str) -> bool:
    return bool(SENSITIVE_MEMORY_PATTERN.search(value))


def is_company_fact_memory(memory_type: str) -> bool:
    return memory_type.strip() == "company_fact"
