"""Knowledge file document version timeline (Phase 5)."""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .models import KnowledgeFile


def collect_version_chain(db: Session, file_uuid: str) -> list[KnowledgeFile]:
    """Return all versions related to a knowledge file, oldest first."""
    seed = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_uuid,
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if seed is None:
        return []

    # BFS/DFS over parent/replaced links within same logical document
    root = seed
    visited_ids: set[int] = {int(seed.id)}
    queue = [seed]
    while queue:
        node = queue.pop(0)
        if node.parent_file_id:
            parent = db.get(KnowledgeFile, node.parent_file_id)
            if parent is not None and int(parent.id) not in visited_ids:
                visited_ids.add(int(parent.id))
                queue.append(parent)
                root = parent if (parent.parent_file_id is None) else root
        if node.replaced_by_file_id:
            child = db.get(KnowledgeFile, node.replaced_by_file_id)
            if child is not None and int(child.id) not in visited_ids:
                visited_ids.add(int(child.id))
                queue.append(child)

    # Also pull siblings that share parent chain via parent_file_id pointing into set
    related = list(
        db.scalars(
            select(KnowledgeFile).where(
                or_(
                    KnowledgeFile.id.in_(visited_ids),
                    KnowledgeFile.parent_file_id.in_(visited_ids),
                    KnowledgeFile.replaced_by_file_id.in_(visited_ids),
                ),
                KnowledgeFile.deleted_at.is_(None),
                KnowledgeFile.hard_deleted_at.is_(None),
            )
        )
    )
    # Stabilize: by version then created_at
    related.sort(key=lambda r: (int(r.version or 0), str(r.created_at or "")))
    return related


def version_timeline(db: Session, file_uuid: str) -> dict:
    rows = collect_version_chain(db, file_uuid)
    if not rows:
        return {"file_uuid": file_uuid, "items": [], "effective_uuid": None}
    items = []
    effective_uuid = None
    for row in rows:
        item = {
            "file_uuid": row.uuid,
            "file_name": row.file_name or row.original_file_name or "",
            "version": int(row.version or 1),
            "is_current_version": bool(row.is_current_version),
            "review_status": row.review_status or "",
            "status": row.status or "",
            "rag_enabled": bool(row.rag_enabled),
            "summary": (row.summary or "")[:300],
            "created_at": row.created_at.isoformat() if getattr(row, "created_at", None) else "",
            "updated_at": row.updated_at.isoformat() if getattr(row, "updated_at", None) else "",
            "parent_file_id": row.parent_file_id,
            "replaced_by_file_id": row.replaced_by_file_id,
        }
        items.append(item)
        if row.is_current_version:
            effective_uuid = row.uuid
    if effective_uuid is None and items:
        # fallback: highest version
        effective_uuid = items[-1]["file_uuid"]
    return {
        "file_uuid": file_uuid,
        "items": items,
        "effective_uuid": effective_uuid,
        "total": len(items),
    }


def set_effective_version(
    db: Session,
    file_uuid: str,
    *,
    actor: str,
) -> KnowledgeFile | None:
    """Mark the given file as the sole current/effective version in its chain."""
    target = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_uuid,
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if target is None:
        return None
    chain = collect_version_chain(db, file_uuid)
    for row in chain:
        row.is_current_version = row.uuid == target.uuid
        if row.uuid == target.uuid:
            row.reviewed_by = actor or row.reviewed_by
        db.add(row)
    db.flush()
    return target
