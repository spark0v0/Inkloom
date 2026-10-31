"""Planning conversations and bounded chapter history reads."""
import sqlalchemy as sa
from alembic import op

revision = "f17b6d429ea5"
down_revision = "e06a5c318d94"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("planning_conversations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("novel_id", sa.String(), sa.ForeignKey("novels.id"), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("chapter_ids", sa.JSON(), nullable=False),
        sa.Column("last_job_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False))
    op.create_index("ix_planning_conversations_novel_id", "planning_conversations", ["novel_id"])
    op.add_column("jobs", sa.Column("conversation_id", sa.String(), nullable=True))
    op.add_column("jobs", sa.Column("conversation_turn", sa.Integer(), nullable=True))
    op.create_index("ix_jobs_conversation_id", "jobs", ["conversation_id"])
    op.create_index("uq_discussion_turn", "jobs", ["conversation_id", "conversation_turn"], unique=True)
    op.create_index("ix_versions_chapter_history", "versions", ["chapter_id", "created_at", "id"])


def downgrade():
    op.drop_index("ix_versions_chapter_history", table_name="versions")
    op.drop_index("ix_jobs_conversation_id", table_name="jobs")
    op.drop_index("uq_discussion_turn", table_name="jobs")
    op.drop_column("jobs", "conversation_turn")
    op.drop_column("jobs", "conversation_id")
    op.drop_table("planning_conversations")
