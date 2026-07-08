import uuid as uuid_lib
from dataclasses import dataclass
from typing import Final

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..crypto import ContentCipher, EncryptedPayload
from ..models import KnowledgeItem, KnowledgeTaskLink, Task
from .errors import GovernanceError
from .schemas import KnowledgeCreateIn, KnowledgeOut, KnowledgeUpdateIn


KNOWLEDGE_CATEGORIES: Final[frozenset[str]] = frozenset(
    {
        "COMPANY",
        "PRODUCT",
        "SERVICE",
        "SALES_SCRIPT",
        "DELIVERY",
        "TENDER",
        "FAQ",
        "CASE",
        "TRAINING",
        "COMPLIANCE",
        "TECHNICAL",
    }
)


@dataclass(frozen=True, slots=True)
class KnowledgeWithTasks:
    item: KnowledgeItem
    task_uuids: list[str]


def _validate_category(category: str) -> None:
    if category not in KNOWLEDGE_CATEGORIES:
        raise GovernanceError(
            422,
            "KNOWLEDGE_CATEGORY_INVALID",
            "知识分类不受支持",
        )


def _tasks_for_uuids(db: Session, task_uuids: list[str]) -> list[Task]:
    unique_uuids = list(dict.fromkeys(task_uuids))
    tasks = list(
        db.scalars(select(Task).where(Task.uuid.in_(unique_uuids))).all()
    )
    if len(tasks) != len(unique_uuids):
        raise GovernanceError(
            422,
            "KNOWLEDGE_TASK_INVALID",
            "知识关联包含不存在的任务",
        )
    return tasks


def _knowledge_or_error(db: Session, knowledge_uuid: str) -> KnowledgeItem:
    item = db.scalar(
        select(KnowledgeItem).where(KnowledgeItem.uuid == knowledge_uuid)
    )
    if item is None:
        raise GovernanceError(404, "KNOWLEDGE_NOT_FOUND", "知识不存在")
    return item


def _task_uuids(db: Session, knowledge_id: int) -> list[str]:
    return list(
        db.scalars(
            select(Task.uuid)
            .join(KnowledgeTaskLink, KnowledgeTaskLink.task_id == Task.id)
            .where(KnowledgeTaskLink.knowledge_id == knowledge_id)
            .order_by(Task.uuid)
        ).all()
    )


def knowledge_out(
    db: Session,
    item: KnowledgeItem,
    *,
    content: str | None = None,
) -> KnowledgeOut:
    return KnowledgeOut(
        uuid=item.uuid,
        title=item.title,
        category=item.category,
        tags=item.tags_json or [],
        keywords=item.keywords_json or [],
        priority=item.priority,
        status=item.status,
        task_uuids=_task_uuids(db, item.id),
        content=content,
    )


def list_knowledge(db: Session) -> list[KnowledgeOut]:
    items = db.scalars(
        select(KnowledgeItem).order_by(
            KnowledgeItem.priority.desc(),
            KnowledgeItem.id,
        )
    ).all()
    return [knowledge_out(db, item) for item in items]


def create_knowledge(
    db: Session,
    body: KnowledgeCreateIn,
    actor_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> KnowledgeItem:
    _validate_category(body.category)
    tasks = _tasks_for_uuids(db, body.task_uuids)
    item_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(
        {"content": body.content},
        item_uuid.encode(),
    )
    item = KnowledgeItem(
        uuid=item_uuid,
        title=body.title,
        category=body.category,
        tags_json=body.tags,
        keywords_json=body.keywords,
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version=key_version,
        priority=body.priority,
        status="ACTIVE",
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(item)
    db.flush()
    db.add_all(
        [
            KnowledgeTaskLink(knowledge_id=item.id, task_id=task.id)
            for task in tasks
        ]
    )
    db.flush()
    return item


def get_knowledge_detail(
    db: Session,
    knowledge_uuid: str,
    cipher: ContentCipher,
) -> KnowledgeOut:
    item = _knowledge_or_error(db, knowledge_uuid)
    payload = cipher.decrypt_json(
        EncryptedPayload(item.content_ciphertext, item.content_nonce),
        item.uuid.encode(),
    )
    return knowledge_out(db, item, content=str(payload.get("content", "")))


def update_knowledge(
    db: Session,
    knowledge_uuid: str,
    body: KnowledgeUpdateIn,
    actor_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> KnowledgeItem:
    item = _knowledge_or_error(db, knowledge_uuid)
    tasks = (
        _tasks_for_uuids(db, body.task_uuids)
        if body.task_uuids is not None
        else None
    )
    if body.category is not None:
        _validate_category(body.category)
    for field in ("title", "category", "priority", "status"):
        value = getattr(body, field)
        if value is not None:
            setattr(item, field, value)
    if body.tags is not None:
        item.tags_json = body.tags
    if body.keywords is not None:
        item.keywords_json = body.keywords
    if body.content is not None:
        encrypted = cipher.encrypt_json(
            {"content": body.content},
            item.uuid.encode(),
        )
        item.content_ciphertext = encrypted.ciphertext
        item.content_nonce = encrypted.nonce
        item.key_version = key_version
    if tasks is not None:
        db.execute(
            delete(KnowledgeTaskLink).where(
                KnowledgeTaskLink.knowledge_id == item.id
            )
        )
        db.add_all(
            [
                KnowledgeTaskLink(knowledge_id=item.id, task_id=task.id)
                for task in tasks
            ]
        )
    item.updated_by = actor_id
    db.flush()
    return item


def disable_knowledge(
    db: Session,
    knowledge_uuid: str,
    actor_id: str,
) -> KnowledgeItem:
    item = _knowledge_or_error(db, knowledge_uuid)
    item.status = "DISABLED"
    item.updated_by = actor_id
    return item
