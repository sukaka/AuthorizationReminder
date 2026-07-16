"""add scoped enterprise graph relations and reviewed organization memory

Revision ID: 0060_enterprise_graph_memory
Revises: 0059_enterprise_metrics_health

Graph edges and memory proposals are additive.  Existing business facts remain
authoritative; memory versions are pending review until an explicit approval.
"""

from alembic import op
import sqlalchemy as sa


revision = "0060_enterprise_graph_memory"
down_revision = "0059_enterprise_metrics_health"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.create_table(
        "ai_enterprise_graph_relations",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_entity_type", sa.String(48), nullable=False),
        sa.Column("source_entity_uuid", sa.String(64), nullable=False),
        sa.Column("relation_type", sa.String(64), nullable=False),
        sa.Column("target_entity_type", sa.String(48), nullable=False),
        sa.Column("target_entity_uuid", sa.String(64), nullable=False),
        sa.Column("direction", sa.String(16), nullable=False, server_default="directed"),
        sa.Column("weight", sa.Float(), nullable=False, server_default="1"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("source", sa.String(64), nullable=False, server_default="manual"),
        sa.Column("scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id",
            "source_entity_type",
            "source_entity_uuid",
            "relation_type",
            "target_entity_type",
            "target_entity_uuid",
            "source_version",
            name="uq_ai_enterprise_graph_relations_natural_key",
        ),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_graph_relations_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_graph_relations_source_entity_type", ["source_entity_type"]),
        ("ix_ai_enterprise_graph_relations_source_entity_uuid", ["source_entity_uuid"]),
        ("ix_ai_enterprise_graph_relations_relation_type", ["relation_type"]),
        ("ix_ai_enterprise_graph_relations_target_entity_type", ["target_entity_type"]),
        ("ix_ai_enterprise_graph_relations_target_entity_uuid", ["target_entity_uuid"]),
        ("ix_ai_enterprise_graph_relations_status", ["status"]),
        ("ix_ai_enterprise_graph_relations_scope_fingerprint", ["scope_fingerprint"]),
    ):
        op.create_index(index_name, "ai_enterprise_graph_relations", columns)

    op.create_table(
        "ai_enterprise_graph_relation_evidence",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("relation_id", id_type, sa.ForeignKey("ai_enterprise_graph_relations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evidence_type", sa.String(48), nullable=False),
        sa.Column("evidence_uuid", sa.String(64), nullable=False),
        sa.Column("source_table", sa.String(128), nullable=False, server_default=""),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("evidence_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        *_timestamps(),
        sa.UniqueConstraint(
            "relation_id", "evidence_type", "evidence_uuid", "source_version",
            name="uq_ai_enterprise_graph_relation_evidence_natural_key",
        ),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_graph_relation_evidence_relation_id", ["relation_id"]),
        ("ix_ai_enterprise_graph_relation_evidence_evidence_type", ["evidence_type"]),
        ("ix_ai_enterprise_graph_relation_evidence_evidence_uuid", ["evidence_uuid"]),
    ):
        op.create_index(index_name, "ai_enterprise_graph_relation_evidence", columns)

    op.create_table(
        "ai_enterprise_org_memory_items",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("memory_key", sa.String(128), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("memory_type", sa.String(32), nullable=False, server_default="fact"),
        sa.Column("sensitivity", sa.String(24), nullable=False, server_default="standard"),
        sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
        sa.Column("current_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("source_scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("approved_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint("organization_id", "memory_key", name="uq_ai_enterprise_org_memory_items_org_key"),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_org_memory_items_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_org_memory_items_memory_key", ["memory_key"]),
        ("ix_ai_enterprise_org_memory_items_memory_type", ["memory_type"]),
        ("ix_ai_enterprise_org_memory_items_status", ["status"]),
        ("ix_ai_enterprise_org_memory_items_source_scope_fingerprint", ["source_scope_fingerprint"]),
    ):
        op.create_index(index_name, "ai_enterprise_org_memory_items", columns)

    op.create_table(
        "ai_enterprise_org_memory_versions",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("memory_item_id", id_type, sa.ForeignKey("ai_enterprise_org_memory_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("source_refs_json", sa.JSON(), nullable=False),
        sa.Column("source_scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending_review"),
        sa.Column("change_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("reviewed_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("memory_item_id", "version", name="uq_ai_enterprise_org_memory_versions_item_version"),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_org_memory_versions_memory_item_id", ["memory_item_id"]),
        ("ix_ai_enterprise_org_memory_versions_source_scope_fingerprint", ["source_scope_fingerprint"]),
        ("ix_ai_enterprise_org_memory_versions_source_hash", ["source_hash"]),
        ("ix_ai_enterprise_org_memory_versions_status", ["status"]),
    ):
        op.create_index(index_name, "ai_enterprise_org_memory_versions", columns)

    op.create_table(
        "ai_enterprise_org_memory_reviews",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("memory_version_id", id_type, sa.ForeignKey("ai_enterprise_org_memory_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(24), nullable=False),
        sa.Column("reviewer_user_id", sa.String(64), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        *_timestamps(),
        sa.UniqueConstraint("memory_version_id", name="uq_ai_enterprise_org_memory_reviews_version"),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_org_memory_reviews_memory_version_id", ["memory_version_id"]),
        ("ix_ai_enterprise_org_memory_reviews_action", ["action"]),
        ("ix_ai_enterprise_org_memory_reviews_reviewer_user_id", ["reviewer_user_id"]),
    ):
        op.create_index(index_name, "ai_enterprise_org_memory_reviews", columns)

    op.create_table(
        "ai_enterprise_org_memory_candidates",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("memory_key", sa.String(128), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("source_refs_json", sa.JSON(), nullable=False),
        sa.Column("source_scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("candidate_fingerprint", sa.String(64), nullable=False),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("reviewed_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id", "candidate_fingerprint",
            name="uq_ai_enterprise_org_memory_candidates_fingerprint",
        ),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_org_memory_candidates_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_org_memory_candidates_memory_key", ["memory_key"]),
        ("ix_ai_enterprise_org_memory_candidates_source_scope_fingerprint", ["source_scope_fingerprint"]),
        ("ix_ai_enterprise_org_memory_candidates_fingerprint", ["candidate_fingerprint"]),
        ("ix_ai_enterprise_org_memory_candidates_status", ["status"]),
    ):
        op.create_index(index_name, "ai_enterprise_org_memory_candidates", columns)


def downgrade() -> None:
    for index_name in (
        "ix_ai_enterprise_org_memory_candidates_status",
        "ix_ai_enterprise_org_memory_candidates_fingerprint",
        "ix_ai_enterprise_org_memory_candidates_source_scope_fingerprint",
        "ix_ai_enterprise_org_memory_candidates_memory_key",
        "ix_ai_enterprise_org_memory_candidates_organization_id",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_org_memory_candidates")
    op.drop_table("ai_enterprise_org_memory_candidates")

    for index_name in (
        "ix_ai_enterprise_org_memory_reviews_reviewer_user_id",
        "ix_ai_enterprise_org_memory_reviews_action",
        "ix_ai_enterprise_org_memory_reviews_memory_version_id",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_org_memory_reviews")
    op.drop_table("ai_enterprise_org_memory_reviews")

    for index_name in (
        "ix_ai_enterprise_org_memory_versions_status",
        "ix_ai_enterprise_org_memory_versions_source_hash",
        "ix_ai_enterprise_org_memory_versions_source_scope_fingerprint",
        "ix_ai_enterprise_org_memory_versions_memory_item_id",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_org_memory_versions")
    op.drop_table("ai_enterprise_org_memory_versions")

    for index_name in (
        "ix_ai_enterprise_org_memory_items_source_scope_fingerprint",
        "ix_ai_enterprise_org_memory_items_status",
        "ix_ai_enterprise_org_memory_items_memory_type",
        "ix_ai_enterprise_org_memory_items_memory_key",
        "ix_ai_enterprise_org_memory_items_organization_id",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_org_memory_items")
    op.drop_table("ai_enterprise_org_memory_items")

    for index_name in (
        "ix_ai_enterprise_graph_relation_evidence_evidence_uuid",
        "ix_ai_enterprise_graph_relation_evidence_evidence_type",
        "ix_ai_enterprise_graph_relation_evidence_relation_id",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_graph_relation_evidence")
    op.drop_table("ai_enterprise_graph_relation_evidence")

    for index_name in (
        "ix_ai_enterprise_graph_relations_scope_fingerprint",
        "ix_ai_enterprise_graph_relations_status",
        "ix_ai_enterprise_graph_relations_target_entity_uuid",
        "ix_ai_enterprise_graph_relations_target_entity_type",
        "ix_ai_enterprise_graph_relations_relation_type",
        "ix_ai_enterprise_graph_relations_source_entity_uuid",
        "ix_ai_enterprise_graph_relations_source_entity_type",
        "ix_ai_enterprise_graph_relations_organization_id",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_graph_relations")
    op.drop_table("ai_enterprise_graph_relations")
