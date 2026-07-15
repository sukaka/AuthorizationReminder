import json
import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.crypto import ContentCipher
from app.database import SessionLocal
from app.professional_delivery.catalog_service import ensure_builtin_catalog
from app.professional_delivery.models import (
    ApprovalFlowDefinition,
    QualityRuleDefinition,
    SkillDefinition,
    TemplateDefinition,
)


def seed_professional_catalog(
    db: Session,
    *,
    cipher: ContentCipher,
    key_version: str,
) -> dict[str, int]:
    """Seed the built-in 3.0 catalog and return authoritative totals."""
    try:
        result = ensure_builtin_catalog(
            db,
            cipher=cipher,
            key_version=key_version,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "created_count": result.created_count,
        "skill_count": db.scalar(select(func.count(SkillDefinition.id))) or 0,
        "template_count": db.scalar(select(func.count(TemplateDefinition.id))) or 0,
        "approval_flow_count": (
            db.scalar(select(func.count(ApprovalFlowDefinition.id))) or 0
        ),
        "quality_rule_count": (
            db.scalar(select(func.count(QualityRuleDefinition.id))) or 0
        ),
    }


def main() -> None:
    settings = get_settings()
    cipher = ContentCipher(settings.content_encryption_key)
    with SessionLocal() as db:
        summary = seed_professional_catalog(
            db,
            cipher=cipher,
            key_version=settings.content_encryption_key_version,
        )
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
