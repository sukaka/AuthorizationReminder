"""shared faq lifecycle fields

Revision ID: 0027_shared_faq_lifecycle
Revises: 0026_agent_run_contracts
Create Date: 2026-07-12
"""

from alembic import op
import sqlalchemy as sa

revision = "0027_shared_faq_lifecycle"
down_revision = "0026_agent_run_contracts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_shared_faqs") as batch:
        batch.add_column(sa.Column("previous_answer", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    # Existing rows treated as published for matching continuity
    op.execute("UPDATE ai_shared_faqs SET status = 'published' WHERE status IN ('active', 'published')")


def downgrade() -> None:
    with op.batch_alter_table("ai_shared_faqs") as batch:
        batch.drop_column("version")
        batch.drop_column("previous_answer")
