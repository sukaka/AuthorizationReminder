from __future__ import annotations

import hashlib
import re
import uuid as uuid_lib
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..crypto import ContentCipher, EncryptedPayload
from ..models import KnowledgeChunk, KnowledgeFile, WorkArtifact, WorkArtifactVersion
from ..project_context_models import ProjectFile
from ..project_workspace_models import Project
from .fact_schemas import EvidenceAttachIn, FactPatchIn
from .models import (
    DeliverableEvidence,
    DeliverableFact,
    DeliverableIdempotencyRecord,
    FactEvidenceLink,
    SkillVersion,
)
from .service import (
    ProfessionalDeliveryError,
    _canonical_hash,
    _require_deliverable_write_access,
    deliverable_version_payload,
    get_deliverable_version,
    get_visible_deliverable,
    recompute_fact_status,
)


FACT_EXTRACT_OPERATION = "deliverable.facts.extract"
FACT_UPDATE_OPERATION = "deliverable.fact.update"
EVIDENCE_ATTACH_OPERATION = "deliverable.evidence.attach"
EVIDENCE_REVOKE_OPERATION = "deliverable.evidence.revoke"
CLAIM_TYPES = frozenset({"fact", "analysis", "inference", "suggestion"})
NUMBER_PATTERN = re.compile(r"(?:\d[\d,]*(?:\.\d+)?%?|\d{4}[年./-]\d{1,2})")
NUMERIC_VALUE_PATTERN = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?%?")
DERIVED_EXPRESSIONS = frozenset(
    {
        "sum(input_facts)",
        "average(input_facts)",
        "subtract(input_facts)",
        "multiply(input_facts)",
        "divide(input_facts)",
        "percentage(input_facts)",
    }
)


@dataclass(frozen=True, slots=True)
class FactExtractionResult:
    artifact: WorkArtifact
    version: WorkArtifactVersion
    facts: list[DeliverableFact]
    replayed: bool


@dataclass(frozen=True, slots=True)
class FactMutationResult:
    artifact: WorkArtifact
    version: WorkArtifactVersion
    fact: DeliverableFact
    replayed: bool


@dataclass(frozen=True, slots=True)
class EvidenceAttachResult:
    artifact: WorkArtifact
    version: WorkArtifactVersion
    fact: DeliverableFact
    evidence: DeliverableEvidence
    link: FactEvidenceLink
    replayed: bool


@dataclass(frozen=True, slots=True)
class EvidenceRevokeResult:
    artifact: WorkArtifact
    version: WorkArtifactVersion
    evidence: DeliverableEvidence
    replayed: bool


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _fact_not_found() -> ProfessionalDeliveryError:
    return ProfessionalDeliveryError("FACT_NOT_FOUND", "事实不存在", 404)


def _evidence_not_found() -> ProfessionalDeliveryError:
    return ProfessionalDeliveryError("EVIDENCE_NOT_FOUND", "证据不存在", 404)


def _fact_claim_text(fact: DeliverableFact, cipher: ContentCipher) -> str:
    decrypted = cipher.decrypt_json(
        EncryptedPayload(fact.claim_ciphertext, fact.claim_nonce),
        fact.uuid.encode("utf-8"),
    )
    return str(decrypted.get("claim_text") or "")


def _fact_rationale(fact: DeliverableFact, cipher: ContentCipher) -> str:
    if fact.rationale_ciphertext is None or fact.rationale_nonce is None:
        return ""
    decrypted = cipher.decrypt_json(
        EncryptedPayload(fact.rationale_ciphertext, fact.rationale_nonce),
        f"{fact.uuid}:rationale".encode("utf-8"),
    )
    return str(decrypted.get("rationale") or "")


def fact_payload(
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
    fact: DeliverableFact,
    cipher: ContentCipher,
) -> dict[str, Any]:
    return {
        "fact_uuid": fact.uuid,
        "deliverable_uuid": artifact.uuid,
        "version_uuid": version.uuid,
        "content_hash": fact.deliverable_content_hash,
        "block_id": fact.block_id,
        "char_start": fact.char_start,
        "char_end": fact.char_end,
        "claim_type": fact.claim_type,
        "claim_text": _fact_claim_text(fact, cipher),
        "claim_hash": fact.claim_hash,
        "critical": fact.critical,
        "status": fact.status,
        "source_required": fact.source_required,
        "human_confirmation_required": fact.human_confirmation_required,
        "rationale": _fact_rationale(fact, cipher),
        "confirmed_by": fact.confirmed_by,
        "confirmed_at": fact.confirmed_at,
        "row_version": fact.row_version,
        "created_at": fact.created_at,
        "updated_at": fact.updated_at,
    }


def _evidence_quote(evidence: DeliverableEvidence, cipher: ContentCipher) -> str:
    decrypted = cipher.decrypt_json(
        EncryptedPayload(evidence.quote_ciphertext, evidence.quote_nonce),
        evidence.uuid.encode("utf-8"),
    )
    return str(decrypted.get("quote") or "")


def evidence_payload(
    db: Session,
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
    evidence: DeliverableEvidence,
    cipher: ContentCipher,
) -> dict[str, Any]:
    project = db.get(Project, evidence.project_id) if evidence.project_id else None
    return {
        "evidence_uuid": evidence.uuid,
        "deliverable_uuid": artifact.uuid,
        "version_uuid": version.uuid,
        "project_uuid": project.uuid if project is not None else None,
        "source_type": evidence.source_type,
        "source_uuid": evidence.source_uuid,
        "source_version": evidence.source_version,
        "source_content_hash": evidence.source_content_hash,
        "quote": _evidence_quote(evidence, cipher),
        "quote_hash": evidence.quote_hash,
        "location": {
            "file_name": evidence.file_name,
            "page_number": evidence.page_number,
            "sheet_name": evidence.sheet_name,
            "cell_range": evidence.cell_range,
            "section_title": evidence.section_title,
            "paragraph_index": evidence.paragraph_index,
            "chunk_id": evidence.chunk_id,
        },
        "captured_by": evidence.captured_by,
        "captured_at": evidence.captured_at,
        "permission_snapshot_hash": evidence.permission_snapshot_hash,
        "status": evidence.status,
        "stale_reason": evidence.stale_reason,
        "revoked_reason": evidence.revoked_reason,
        "row_version": evidence.row_version,
    }


def link_payload(
    link: FactEvidenceLink,
    *,
    fact: DeliverableFact,
    evidence: DeliverableEvidence,
) -> dict[str, Any]:
    return {
        "link_uuid": link.uuid,
        "fact_uuid": fact.uuid,
        "evidence_uuid": evidence.uuid,
        "relation": link.relation,
        "derived_expression": link.derived_expression,
        "input_fact_uuids": list(link.input_fact_uuids_json or []),
        "rounding_rule": link.rounding_rule,
        "status": link.status,
        "linked_by": link.linked_by,
        "created_at": link.created_at,
    }


def _idempotency_record(
    db: Session,
    *,
    actor_user_id: str,
    operation: str,
    idempotency_key: str,
) -> DeliverableIdempotencyRecord | None:
    return db.scalar(
        select(DeliverableIdempotencyRecord).where(
            DeliverableIdempotencyRecord.actor_user_id == actor_user_id,
            DeliverableIdempotencyRecord.operation == operation,
            DeliverableIdempotencyRecord.idempotency_key == idempotency_key,
        )
    )


def _validate_replay(
    record: DeliverableIdempotencyRecord,
    *,
    request_hash: str,
    deliverable_id: int,
    version_id: int,
) -> None:
    if record.request_hash != request_hash:
        raise ProfessionalDeliveryError(
            "IDEMPOTENCY_KEY_REUSED",
            "该幂等键已用于不同请求",
            409,
        )
    if record.deliverable_id != deliverable_id or record.version_id != version_id:
        raise ProfessionalDeliveryError(
            "IDEMPOTENCY_RECORD_INVALID",
            "幂等记录与当前成果版本不一致",
            409,
        )


def _store_idempotency(
    db: Session,
    *,
    actor_user_id: str,
    operation: str,
    idempotency_key: str,
    request_hash: str,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
) -> None:
    db.add(
        DeliverableIdempotencyRecord(
            actor_user_id=actor_user_id,
            operation=operation,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            deliverable_id=artifact.id,
            version_id=version.id,
            status="completed",
        )
    )


def list_version_facts(
    db: Session,
    *,
    deliverable_uuid: str,
    version_uuid: str,
    actor_user_id: str,
) -> tuple[WorkArtifact, WorkArtifactVersion, list[DeliverableFact]]:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
    )
    version = get_deliverable_version(
        db,
        artifact=access.artifact,
        version_uuid=version_uuid,
    )
    facts = list(
        db.scalars(
            select(DeliverableFact)
            .where(DeliverableFact.deliverable_version_id == version.id)
            .order_by(DeliverableFact.id.asc())
        )
    )
    return access.artifact, version, facts


def _block_fact_text(block: dict[str, Any]) -> str:
    for key in ("text", "claim", "content", "value"):
        value = block.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def extract_version_facts(
    db: Session,
    *,
    deliverable_uuid: str,
    version_uuid: str,
    content_hash: str,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
    key_version: str,
) -> FactExtractionResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    _require_deliverable_write_access(access)
    artifact = access.artifact
    version = get_deliverable_version(db, artifact=artifact, version_uuid=version_uuid)
    if version.content_hash != content_hash:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_FACT_TARGET_STALE",
            "事实提取目标与成果版本内容不一致",
            409,
        )
    request_hash = _canonical_hash(
        {
            "deliverable_uuid": deliverable_uuid,
            "version_uuid": version_uuid,
            "content_hash": content_hash,
        }
    )
    existing_record = _idempotency_record(
        db,
        actor_user_id=actor_user_id,
        operation=FACT_EXTRACT_OPERATION,
        idempotency_key=idempotency_key,
    )
    if existing_record is not None:
        _validate_replay(
            existing_record,
            request_hash=request_hash,
            deliverable_id=artifact.id,
            version_id=version.id,
        )
        facts = list(
            db.scalars(
                select(DeliverableFact)
                .where(DeliverableFact.deliverable_version_id == version.id)
                .order_by(DeliverableFact.id.asc())
            )
        )
        return FactExtractionResult(artifact, version, facts, True)

    facts = list(
        db.scalars(
            select(DeliverableFact)
            .where(DeliverableFact.deliverable_version_id == version.id)
            .order_by(DeliverableFact.id.asc())
        )
    )
    if not facts:
        content = deliverable_version_payload(db, version=version, cipher=cipher)[
            "content"
        ]
        skill_version = (
            db.get(SkillVersion, version.skill_version_id)
            if version.skill_version_id is not None
            else None
        )
        fact_policy = dict(skill_version.fact_policy_json or {}) if skill_version else {}
        extraction_batch_uuid = str(uuid_lib.uuid4())
        for block in content.get("blocks", []):
            if not isinstance(block, dict):
                continue
            block_id = str(block.get("block_id") or "").strip()
            claim_text = _block_fact_text(block)
            if not block_id or not claim_text:
                continue
            claim_type = str(block.get("claim_type") or "fact").strip().lower()
            if claim_type not in CLAIM_TYPES:
                claim_type = "fact"
            has_number = NUMBER_PATTERN.search(claim_text) is not None
            critical = block.get("critical") is True or has_number
            critical_source_policy = fact_policy.get(
                "critical_facts_require_source",
                True,
            ) is not False
            numeric_source_policy = fact_policy.get(
                "critical_numbers_require_source",
                True,
            ) is not False
            source_required = critical and (
                critical_source_policy or (has_number and numeric_source_policy)
            )
            fact_uuid = str(uuid_lib.uuid4())
            encrypted = cipher.encrypt_json(
                {"claim_text": claim_text},
                fact_uuid.encode("utf-8"),
            )
            fact = DeliverableFact(
                uuid=fact_uuid,
                deliverable_id=artifact.id,
                deliverable_version_id=version.id,
                deliverable_content_hash=version.content_hash,
                block_id=block_id,
                char_start=None,
                char_end=None,
                claim_type=claim_type,
                claim_ciphertext=encrypted.ciphertext,
                claim_nonce=encrypted.nonce,
                claim_hash=_sha256(claim_text),
                key_version=key_version,
                critical=critical,
                status=(
                    "inference" if claim_type == "inference" else "pending_confirmation"
                ),
                source_required=source_required,
                human_confirmation_required=(
                    fact_policy.get("human_confirmation_required") is True
                ),
                extraction_batch_uuid=extraction_batch_uuid,
                created_by=actor_user_id,
                updated_by=actor_user_id,
                row_version=1,
            )
            db.add(fact)
            facts.append(fact)
        db.flush()

    _store_idempotency(
        db,
        actor_user_id=actor_user_id,
        operation=FACT_EXTRACT_OPERATION,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        artifact=artifact,
        version=version,
    )
    db.flush()
    return FactExtractionResult(artifact, version, facts, False)


def _knowledge_location(chunk: KnowledgeChunk, file: KnowledgeFile) -> dict[str, Any]:
    metadata = dict(chunk.metadata_json or {})
    paragraph_index = metadata.get("paragraph_index")
    if not isinstance(paragraph_index, int) or isinstance(paragraph_index, bool):
        paragraph_index = None
    return {
        "file_name": file.file_name,
        "page_number": chunk.page_number,
        "sheet_name": str(metadata.get("sheet_name") or ""),
        "cell_range": str(metadata.get("cell_range") or ""),
        "section_title": chunk.section_title or "",
        "paragraph_index": paragraph_index,
        "chunk_id": chunk.chunk_id,
    }


def _decrypt_chunk(chunk: KnowledgeChunk, cipher: ContentCipher) -> str:
    try:
        value = cipher.decrypt_json(
            EncryptedPayload(chunk.chunk_text_ciphertext, chunk.chunk_text_nonce),
            chunk.chunk_id.encode("utf-8"),
        )
    except Exception as exc:
        raise ProfessionalDeliveryError(
            "EVIDENCE_SOURCE_UNAVAILABLE",
            "证据来源当前不可用",
            422,
        ) from exc
    return str(value.get("text") or "")


def _is_active_knowledge_source(file: KnowledgeFile, chunk: KnowledgeChunk) -> bool:
    return (
        file.status == "READY"
        and file.deleted_at is None
        and file.is_current_version is True
        and file.reference_enabled is True
        and chunk.status == "READY"
        and chunk.deleted_at is None
    )


def _source_allowed(
    db: Session,
    *,
    artifact: WorkArtifact,
    actor_user_id: str,
    file: KnowledgeFile,
) -> tuple[bool, str]:
    if artifact.scope_type == "personal":
        allowed = actor_user_id in {file.owner_user_id, file.sso_user_id}
        return allowed, "owner" if allowed else ""
    if artifact.project_id is None:
        return False, ""
    project_file = db.scalar(
        select(ProjectFile).where(
            ProjectFile.project_id == artifact.project_id,
            ProjectFile.knowledge_file_id == file.id,
            ProjectFile.status == "active",
        )
    )
    return project_file is not None, "project_member" if project_file else ""


def _resolve_knowledge_source(
    db: Session,
    *,
    artifact: WorkArtifact,
    actor_user_id: str,
    source_uuid: str,
    cipher: ContentCipher,
) -> tuple[KnowledgeFile, KnowledgeChunk, str, dict[str, Any], str]:
    chunk = db.scalar(
        select(KnowledgeChunk).where(KnowledgeChunk.chunk_id == source_uuid)
    )
    file = db.get(KnowledgeFile, chunk.file_id) if chunk is not None else None
    if chunk is None or file is None:
        raise ProfessionalDeliveryError(
            "EVIDENCE_SOURCE_NOT_FOUND",
            "证据来源不存在",
            404,
        )
    allowed, permission_role = _source_allowed(
        db,
        artifact=artifact,
        actor_user_id=actor_user_id,
        file=file,
    )
    if not allowed:
        raise ProfessionalDeliveryError(
            "EVIDENCE_SOURCE_SCOPE_MISMATCH",
            "证据来源不属于当前成果范围",
            422,
        )
    if not _is_active_knowledge_source(file, chunk):
        raise ProfessionalDeliveryError(
            "EVIDENCE_SOURCE_UNAVAILABLE",
            "证据来源当前不可用",
            422,
        )
    quote = _decrypt_chunk(chunk, cipher)
    permission_hash = _canonical_hash(
        {
            "scope_type": artifact.scope_type,
            "project_id": artifact.project_id,
            "file_id": file.id,
            "file_version": file.version,
            "permission_role": permission_role,
        }
    )
    return file, chunk, quote, _knowledge_location(chunk, file), permission_hash


def search_evidence_candidates(
    db: Session,
    *,
    deliverable_uuid: str,
    version_uuid: str,
    actor_user_id: str,
    query: str,
    limit: int,
    cipher: ContentCipher,
) -> tuple[WorkArtifact, WorkArtifactVersion, list[dict[str, Any]]]:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
    )
    artifact = access.artifact
    version = get_deliverable_version(db, artifact=artifact, version_uuid=version_uuid)
    statement = (
        select(KnowledgeChunk, KnowledgeFile)
        .join(KnowledgeFile, KnowledgeFile.id == KnowledgeChunk.file_id)
        .where(
            KnowledgeFile.status == "READY",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.is_current_version.is_(True),
            KnowledgeFile.reference_enabled.is_(True),
            KnowledgeChunk.status == "READY",
            KnowledgeChunk.deleted_at.is_(None),
        )
    )
    if artifact.scope_type == "personal":
        statement = statement.where(
            or_(
                KnowledgeFile.owner_user_id == actor_user_id,
                KnowledgeFile.sso_user_id == actor_user_id,
            )
        )
    else:
        statement = statement.join(
            ProjectFile,
            ProjectFile.knowledge_file_id == KnowledgeFile.id,
        ).where(
            ProjectFile.project_id == artifact.project_id,
            ProjectFile.status == "active",
        )
    candidates: list[dict[str, Any]] = []
    needle = query.casefold()
    for chunk, file in db.execute(statement.order_by(KnowledgeChunk.id.asc())).all():
        quote = _decrypt_chunk(chunk, cipher)
        if needle not in quote.casefold():
            continue
        candidates.append(
            {
                "source_type": "knowledge_chunk",
                "source_uuid": chunk.chunk_id,
                "source_version": str(file.version),
                "source_content_hash": file.content_sha256,
                "quote": quote,
                "location": _knowledge_location(chunk, file),
            }
        )
        if len(candidates) >= limit:
            break
    return artifact, version, candidates


def _fact_access(
    db: Session,
    *,
    fact_uuid: str,
    actor_user_id: str,
    lock: bool,
) -> tuple[WorkArtifact, WorkArtifactVersion, DeliverableFact]:
    statement = select(DeliverableFact).where(DeliverableFact.uuid == fact_uuid)
    if lock:
        statement = statement.with_for_update()
    fact = db.scalar(statement)
    artifact = db.get(WorkArtifact, fact.deliverable_id) if fact is not None else None
    if fact is None or artifact is None:
        raise _fact_not_found()
    access = get_visible_deliverable(
        db,
        deliverable_uuid=artifact.uuid,
        actor_user_id=actor_user_id,
        lock=lock,
    )
    version = db.get(WorkArtifactVersion, fact.deliverable_version_id)
    if version is None:
        raise _fact_not_found()
    return access.artifact, version, fact


def _numeric_claim_value(fact: DeliverableFact, cipher: ContentCipher) -> Decimal:
    match = NUMERIC_VALUE_PATTERN.search(_fact_claim_text(fact, cipher))
    if match is None:
        raise ProfessionalDeliveryError(
            "DERIVED_NUMERIC_VALUE_MISSING",
            "派生事实及其输入事实必须包含可计算数字",
            422,
            {"fact_uuid": fact.uuid},
        )
    raw_value = match.group(0).replace(",", "").removesuffix("%")
    try:
        return Decimal(raw_value)
    except InvalidOperation as exc:
        raise ProfessionalDeliveryError(
            "DERIVED_NUMERIC_VALUE_INVALID",
            "派生事实包含无法计算的数字",
            422,
            {"fact_uuid": fact.uuid},
        ) from exc


def _apply_derived_expression(expression: str, values: list[Decimal]) -> Decimal:
    if expression not in DERIVED_EXPRESSIONS:
        raise ProfessionalDeliveryError(
            "DERIVED_EXPRESSION_NOT_ALLOWED",
            "派生事实只能使用系统白名单计算表达式",
            422,
            {"allowed_expressions": sorted(DERIVED_EXPRESSIONS)},
        )
    if not values:
        raise ProfessionalDeliveryError(
            "DERIVED_EVIDENCE_INPUT_INVALID",
            "派生事实至少需要一个输入事实",
            422,
        )
    if expression == "sum(input_facts)":
        return sum(values, Decimal("0"))
    if expression == "average(input_facts)":
        return sum(values, Decimal("0")) / Decimal(len(values))
    if expression == "subtract(input_facts)":
        if len(values) < 2:
            raise ProfessionalDeliveryError(
                "DERIVED_EVIDENCE_INPUT_INVALID",
                "减法计算至少需要两个输入事实",
                422,
            )
        result = values[0]
        for value in values[1:]:
            result -= value
        return result
    if expression == "multiply(input_facts)":
        if len(values) < 2:
            raise ProfessionalDeliveryError(
                "DERIVED_EVIDENCE_INPUT_INVALID",
                "乘法计算至少需要两个输入事实",
                422,
            )
        result = Decimal("1")
        for value in values:
            result *= value
        return result
    if len(values) != 2:
        raise ProfessionalDeliveryError(
            "DERIVED_EVIDENCE_INPUT_INVALID",
            "除法和百分比计算必须且只能提供两个输入事实",
            422,
        )
    if values[1] == 0:
        raise ProfessionalDeliveryError(
            "DERIVED_DIVISION_BY_ZERO",
            "派生事实不能除以零",
            422,
        )
    quotient = values[0] / values[1]
    if expression == "percentage(input_facts)":
        return quotient * Decimal("100")
    return quotient


def _round_derived_value(value: Decimal, rounding_rule: str) -> Decimal:
    if rounding_rule == "none":
        return value
    match = re.fullmatch(r"([0-8])dp", rounding_rule)
    if match is None:
        raise ProfessionalDeliveryError(
            "DERIVED_ROUNDING_RULE_INVALID",
            "舍入规则必须为 none 或 0dp 至 8dp",
            422,
        )
    decimal_places = int(match.group(1))
    quantum = Decimal("1").scaleb(-decimal_places)
    return value.quantize(quantum, rounding=ROUND_HALF_UP)


def _validate_derived_relation(
    db: Session,
    *,
    fact: DeliverableFact,
    body: EvidenceAttachIn,
    cipher: ContentCipher,
) -> None:
    if body.relation != "derived_from":
        return
    if (
        not body.derived_expression
        or not body.input_fact_uuids
        or not body.rounding_rule
    ):
        raise ProfessionalDeliveryError(
            "DERIVED_EVIDENCE_INVALID",
            "派生事实必须提供计算表达式、输入事实和舍入规则",
            422,
        )
    if (
        fact.uuid in body.input_fact_uuids
        or len(body.input_fact_uuids) != len(set(body.input_fact_uuids))
    ):
        raise ProfessionalDeliveryError(
            "DERIVED_EVIDENCE_INPUT_INVALID",
            "派生事实不能引用自身或重复的输入事实",
            422,
        )
    inputs = list(
        db.scalars(
            select(DeliverableFact).where(
                DeliverableFact.uuid.in_(body.input_fact_uuids),
                DeliverableFact.deliverable_version_id == fact.deliverable_version_id,
            )
        )
    )
    if len({item.uuid for item in inputs}) != len(set(body.input_fact_uuids)):
        raise ProfessionalDeliveryError(
            "DERIVED_EVIDENCE_INPUT_INVALID",
            "派生事实输入不属于当前成果版本",
            422,
        )
    inputs_by_uuid = {item.uuid: item for item in inputs}
    computed_value = _apply_derived_expression(
        body.derived_expression,
        [
            _numeric_claim_value(inputs_by_uuid[item_uuid], cipher)
            for item_uuid in body.input_fact_uuids
        ],
    )
    rounded_value = _round_derived_value(computed_value, body.rounding_rule)
    claimed_value = _numeric_claim_value(fact, cipher)
    if claimed_value != rounded_value:
        raise ProfessionalDeliveryError(
            "DERIVED_CALCULATION_MISMATCH",
            "派生事实数值与确定性重算结果不一致",
            422,
            {
                "claimed_value": str(claimed_value),
                "computed_value": str(rounded_value),
            },
        )


def attach_evidence_to_fact(
    db: Session,
    *,
    fact_uuid: str,
    body: EvidenceAttachIn,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
    key_version: str,
) -> EvidenceAttachResult:
    artifact, version, fact = _fact_access(
        db,
        fact_uuid=fact_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    access = get_visible_deliverable(
        db,
        deliverable_uuid=artifact.uuid,
        actor_user_id=actor_user_id,
    )
    _require_deliverable_write_access(access)
    request_hash = _canonical_hash(
        {"fact_uuid": fact_uuid, "body": body.model_dump(mode="json")}
    )
    existing_record = _idempotency_record(
        db,
        actor_user_id=actor_user_id,
        operation=EVIDENCE_ATTACH_OPERATION,
        idempotency_key=idempotency_key,
    )
    if existing_record is not None:
        _validate_replay(
            existing_record,
            request_hash=request_hash,
            deliverable_id=artifact.id,
            version_id=version.id,
        )
        evidence = db.scalar(
            select(DeliverableEvidence)
            .where(
                DeliverableEvidence.deliverable_version_id == version.id,
                DeliverableEvidence.source_type == body.source_type,
                DeliverableEvidence.source_uuid == body.source_uuid,
            )
            .order_by(DeliverableEvidence.id.desc())
        )
        link = (
            db.scalar(
                select(FactEvidenceLink).where(
                    FactEvidenceLink.fact_id == fact.id,
                    FactEvidenceLink.evidence_id == evidence.id,
                    FactEvidenceLink.relation == body.relation,
                )
            )
            if evidence is not None
            else None
        )
        if evidence is None or link is None:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_RECORD_INVALID",
                "幂等记录对应的事实证据不存在",
                409,
            )
        return EvidenceAttachResult(artifact, version, fact, evidence, link, True)

    _validate_derived_relation(db, fact=fact, body=body, cipher=cipher)
    file, chunk, quote, location, permission_hash = _resolve_knowledge_source(
        db,
        artifact=artifact,
        actor_user_id=actor_user_id,
        source_uuid=body.source_uuid,
        cipher=cipher,
    )
    evidence = db.scalar(
        select(DeliverableEvidence).where(
            DeliverableEvidence.deliverable_version_id == version.id,
            DeliverableEvidence.source_type == body.source_type,
            DeliverableEvidence.source_uuid == body.source_uuid,
            DeliverableEvidence.source_content_hash == file.content_sha256,
        )
    )
    if evidence is not None and evidence.status != "active":
        raise ProfessionalDeliveryError(
            "EVIDENCE_SOURCE_REVOKED",
            "该版本中的证据已失效，不能重新关联",
            422,
        )
    if evidence is None:
        evidence_uuid = str(uuid_lib.uuid4())
        encrypted_quote = cipher.encrypt_json(
            {"quote": quote},
            evidence_uuid.encode("utf-8"),
        )
        evidence = DeliverableEvidence(
            uuid=evidence_uuid,
            deliverable_id=artifact.id,
            deliverable_version_id=version.id,
            project_id=artifact.project_id,
            source_type=body.source_type,
            source_uuid=chunk.chunk_id,
            source_version=str(file.version),
            source_content_hash=file.content_sha256,
            file_name=location["file_name"],
            page_number=location["page_number"],
            sheet_name=location["sheet_name"],
            cell_range=location["cell_range"],
            section_title=location["section_title"],
            paragraph_index=location["paragraph_index"],
            chunk_id=location["chunk_id"],
            quote_ciphertext=encrypted_quote.ciphertext,
            quote_nonce=encrypted_quote.nonce,
            quote_hash=_sha256(quote),
            key_version=key_version,
            captured_by=actor_user_id,
            captured_at=_now(),
            permission_snapshot_hash=permission_hash,
            status="active",
            row_version=1,
        )
        db.add(evidence)
        db.flush()

    link = db.scalar(
        select(FactEvidenceLink).where(
            FactEvidenceLink.fact_id == fact.id,
            FactEvidenceLink.evidence_id == evidence.id,
            FactEvidenceLink.relation == body.relation,
        )
    )
    if link is None:
        link = FactEvidenceLink(
            fact_id=fact.id,
            evidence_id=evidence.id,
            relation=body.relation,
            derived_expression=body.derived_expression,
            input_fact_uuids_json=body.input_fact_uuids,
            rounding_rule=body.rounding_rule,
            status="active",
            linked_by=actor_user_id,
        )
        db.add(link)
        db.flush()
    recompute_fact_status(db, fact, actor_user_id)
    _store_idempotency(
        db,
        actor_user_id=actor_user_id,
        operation=EVIDENCE_ATTACH_OPERATION,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        artifact=artifact,
        version=version,
    )
    db.flush()
    return EvidenceAttachResult(artifact, version, fact, evidence, link, False)


def get_evidence_preview(
    db: Session,
    *,
    evidence_uuid: str,
    actor_user_id: str,
) -> tuple[WorkArtifact, WorkArtifactVersion, DeliverableEvidence]:
    evidence = db.scalar(
        select(DeliverableEvidence).where(DeliverableEvidence.uuid == evidence_uuid)
    )
    artifact = (
        db.get(WorkArtifact, evidence.deliverable_id) if evidence is not None else None
    )
    if evidence is None or artifact is None:
        raise _evidence_not_found()
    access = get_visible_deliverable(
        db,
        deliverable_uuid=artifact.uuid,
        actor_user_id=actor_user_id,
    )
    version = db.get(WorkArtifactVersion, evidence.deliverable_version_id)
    if version is None:
        raise _evidence_not_found()
    return access.artifact, version, evidence


def _invalidate_fact_evidence_links(
    db: Session,
    *,
    fact: DeliverableFact,
    reason: str,
    human_confirmation_only: bool,
) -> None:
    rows = db.execute(
        select(FactEvidenceLink, DeliverableEvidence)
        .join(DeliverableEvidence, DeliverableEvidence.id == FactEvidenceLink.evidence_id)
        .where(
            FactEvidenceLink.fact_id == fact.id,
            FactEvidenceLink.status == "active",
        )
    ).all()
    for link, evidence in rows:
        if human_confirmation_only and evidence.source_type != "human_confirmation":
            continue
        link.status = "stale"
        if evidence.source_type == "human_confirmation" and evidence.status == "active":
            evidence.status = "stale"
            evidence.stale_reason = reason
            evidence.row_version += 1


def _record_human_confirmation(
    db: Session,
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
    fact: DeliverableFact,
    actor_user_id: str,
    cipher: ContentCipher,
) -> None:
    claim_text = _fact_claim_text(fact, cipher)
    evidence_uuid = str(uuid_lib.uuid4())
    encrypted_quote = cipher.encrypt_json(
        {"quote": claim_text},
        evidence_uuid.encode("utf-8"),
    )
    evidence = DeliverableEvidence(
        uuid=evidence_uuid,
        deliverable_id=artifact.id,
        deliverable_version_id=version.id,
        project_id=artifact.project_id,
        source_type="human_confirmation",
        source_uuid=str(uuid_lib.uuid4()),
        source_version=str(fact.row_version + 1),
        source_content_hash=fact.claim_hash,
        file_name="",
        page_number=None,
        sheet_name="",
        cell_range="",
        section_title="人工确认",
        paragraph_index=None,
        chunk_id="",
        quote_ciphertext=encrypted_quote.ciphertext,
        quote_nonce=encrypted_quote.nonce,
        quote_hash=_sha256(claim_text),
        key_version=fact.key_version,
        captured_by=actor_user_id,
        captured_at=_now(),
        permission_snapshot_hash=_canonical_hash(
            {
                "actor_user_id": actor_user_id,
                "deliverable_uuid": artifact.uuid,
                "fact_uuid": fact.uuid,
                "claim_hash": fact.claim_hash,
            }
        ),
        status="active",
        row_version=1,
    )
    db.add(evidence)
    db.flush()
    db.add(
        FactEvidenceLink(
            fact_id=fact.id,
            evidence_id=evidence.id,
            relation="supports",
            derived_expression="",
            input_fact_uuids_json=[],
            rounding_rule="",
            status="active",
            linked_by=actor_user_id,
        )
    )


def revoke_evidence(
    db: Session,
    *,
    evidence_uuid: str,
    reason: str,
    actor_user_id: str,
    idempotency_key: str,
) -> EvidenceRevokeResult:
    evidence = db.scalar(
        select(DeliverableEvidence)
        .where(DeliverableEvidence.uuid == evidence_uuid)
        .with_for_update()
    )
    artifact_row = (
        db.get(WorkArtifact, evidence.deliverable_id) if evidence is not None else None
    )
    if evidence is None or artifact_row is None:
        raise _evidence_not_found()
    access = get_visible_deliverable(
        db,
        deliverable_uuid=artifact_row.uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    _require_deliverable_write_access(access)
    artifact = access.artifact
    version = db.get(WorkArtifactVersion, evidence.deliverable_version_id)
    if version is None:
        raise _evidence_not_found()
    request_hash = _canonical_hash(
        {"evidence_uuid": evidence_uuid, "reason": reason}
    )
    existing_record = _idempotency_record(
        db,
        actor_user_id=actor_user_id,
        operation=EVIDENCE_REVOKE_OPERATION,
        idempotency_key=idempotency_key,
    )
    if existing_record is not None:
        _validate_replay(
            existing_record,
            request_hash=request_hash,
            deliverable_id=artifact.id,
            version_id=version.id,
        )
        return EvidenceRevokeResult(artifact, version, evidence, True)
    if evidence.status != "active":
        raise ProfessionalDeliveryError(
            "EVIDENCE_ALREADY_INACTIVE",
            "证据已不是可撤销状态",
            422,
        )

    evidence.status = "revoked"
    evidence.revoked_reason = reason
    evidence.row_version += 1
    fact_ids = list(
        db.scalars(
            select(FactEvidenceLink.fact_id).where(
                FactEvidenceLink.evidence_id == evidence.id,
                FactEvidenceLink.status == "active",
            )
        )
    )
    for fact in db.scalars(
        select(DeliverableFact).where(DeliverableFact.id.in_(fact_ids))
    ):
        recompute_fact_status(db, fact, actor_user_id)

    if (
        artifact.current_version_id == version.id
        and artifact.lifecycle_status not in {"delivered", "archived"}
    ):
        artifact.lifecycle_status = "changes_requested"
        artifact.row_version += 1
        if artifact.approved_version_id == version.id:
            artifact.approved_version_id = None
            artifact.approved_content_hash = ""

    _store_idempotency(
        db,
        actor_user_id=actor_user_id,
        operation=EVIDENCE_REVOKE_OPERATION,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        artifact=artifact,
        version=version,
    )
    db.flush()
    return EvidenceRevokeResult(artifact, version, evidence, False)


def update_fact(
    db: Session,
    *,
    fact_uuid: str,
    body: FactPatchIn,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
) -> FactMutationResult:
    artifact, version, fact = _fact_access(
        db,
        fact_uuid=fact_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    access = get_visible_deliverable(
        db,
        deliverable_uuid=artifact.uuid,
        actor_user_id=actor_user_id,
    )
    _require_deliverable_write_access(access)
    request_hash = _canonical_hash(
        {"fact_uuid": fact_uuid, "body": body.model_dump(mode="json")}
    )
    existing_record = _idempotency_record(
        db,
        actor_user_id=actor_user_id,
        operation=FACT_UPDATE_OPERATION,
        idempotency_key=idempotency_key,
    )
    if existing_record is not None:
        _validate_replay(
            existing_record,
            request_hash=request_hash,
            deliverable_id=artifact.id,
            version_id=version.id,
        )
        return FactMutationResult(artifact, version, fact, True)
    if fact.row_version != body.row_version:
        raise ProfessionalDeliveryError(
            "FACT_VERSION_CONFLICT",
            "事实已被其他操作更新，请刷新后重试",
            409,
            {"current_row_version": fact.row_version},
        )
    claim_changed = False
    if body.claim_text is not None:
        next_claim_hash = _sha256(body.claim_text)
        claim_changed = next_claim_hash != fact.claim_hash
        if claim_changed:
            _invalidate_fact_evidence_links(
                db,
                fact=fact,
                reason="claim_changed",
                human_confirmation_only=False,
            )
            fact.confirmed_by = ""
            fact.confirmed_at = None
        encrypted = cipher.encrypt_json(
            {"claim_text": body.claim_text},
            fact.uuid.encode("utf-8"),
        )
        fact.claim_ciphertext = encrypted.ciphertext
        fact.claim_nonce = encrypted.nonce
        fact.claim_hash = next_claim_hash
    if body.claim_type is not None:
        fact.claim_type = body.claim_type
    if body.critical is not None:
        fact.critical = body.critical
        fact.source_required = body.critical
    if body.rationale is not None:
        if body.rationale:
            encrypted_rationale = cipher.encrypt_json(
                {"rationale": body.rationale},
                f"{fact.uuid}:rationale".encode("utf-8"),
            )
            fact.rationale_ciphertext = encrypted_rationale.ciphertext
            fact.rationale_nonce = encrypted_rationale.nonce
        else:
            fact.rationale_ciphertext = None
            fact.rationale_nonce = None
    if body.status is not None:
        fact.status = body.status
        if body.status == "confirmed":
            fact.confirmed_by = actor_user_id
            fact.confirmed_at = _now()
            _record_human_confirmation(
                db,
                artifact=artifact,
                version=version,
                fact=fact,
                actor_user_id=actor_user_id,
                cipher=cipher,
            )
        elif body.status in {"pending_confirmation", "rejected"}:
            _invalidate_fact_evidence_links(
                db,
                fact=fact,
                reason="confirmation_withdrawn",
                human_confirmation_only=True,
            )
            fact.confirmed_by = ""
            fact.confirmed_at = None
    elif claim_changed:
        recompute_fact_status(db, fact, actor_user_id)
    fact.updated_by = actor_user_id
    fact.row_version += 1
    if (
        artifact.current_version_id == version.id
        and artifact.lifecycle_status not in {"draft", "changes_requested", "delivered", "archived"}
    ):
        artifact.lifecycle_status = "changes_requested"
        artifact.row_version += 1
        if artifact.approved_version_id == version.id:
            artifact.approved_version_id = None
            artifact.approved_content_hash = ""
    _store_idempotency(
        db,
        actor_user_id=actor_user_id,
        operation=FACT_UPDATE_OPERATION,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        artifact=artifact,
        version=version,
    )
    db.flush()
    return FactMutationResult(artifact, version, fact, False)
