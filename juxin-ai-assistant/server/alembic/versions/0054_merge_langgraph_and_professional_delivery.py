"""merge the langgraph and professional delivery migration branches

Revision ID: 0054_merge_langgraph_and_professional_delivery
Revises: 0045_agent_langgraph_checkpoints, 0053_deliverable_media_assets

This is an Alembic graph-only merge.  Both parent revisions already contain
their schema changes; the merge keeps existing databases upgradeable without
rewriting an applied migration.
"""

revision = "0054_merge_langgraph_and_professional_delivery"
down_revision = (
    "0045_agent_langgraph_checkpoints",
    "0053_deliverable_media_assets",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
