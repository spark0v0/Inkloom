"""Author plans and evidence-bound thread progress; no manuscript changes."""
import sqlalchemy as sa

from alembic import op

revision = "c84e3a190b72"
down_revision = "b73d2f809a61"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("thread_tracks",
        sa.Column("entity_id", sa.String(), sa.ForeignKey("entities.id"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("target_chapter_id", sa.String(), sa.ForeignKey("chapters.id"), nullable=True),
        sa.Column("intent", sa.Text(), nullable=False),
        sa.Column("paused", sa.Boolean(), nullable=False))
    op.create_table("thread_progress",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("entity_id", sa.String(), sa.ForeignKey("thread_tracks.entity_id"), nullable=False),
        sa.Column("chapter_id", sa.String(), sa.ForeignKey("chapters.id"), nullable=False),
        sa.Column("version_id", sa.String(), sa.ForeignKey("versions.id"), nullable=False),
        sa.Column("stage", sa.String(), nullable=False), sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False), sa.Column("voided", sa.Boolean(), nullable=False),
        sa.Column("operation_id", sa.String(), nullable=False), sa.Column("request_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False), sa.UniqueConstraint("entity_id", "operation_id"))
    op.create_index("ix_thread_progress_entity_id", "thread_progress", ["entity_id"])


def downgrade():
    op.drop_table("thread_progress")
    op.drop_table("thread_tracks")
