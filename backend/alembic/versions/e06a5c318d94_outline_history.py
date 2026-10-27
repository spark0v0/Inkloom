"""Immutable chapter outline history; preserve all existing planning content."""
import sqlalchemy as sa

from alembic import op

revision = "e06a5c318d94"
down_revision = "d95f4b207c83"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("chapters", sa.Column("outline_revision", sa.Integer(), nullable=False, server_default="0"))
    op.create_table("outline_revisions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("novel_id", sa.String(), sa.ForeignKey("novels.id"), nullable=False),
        sa.Column("chapter_id", sa.String(), sa.ForeignKey("chapters.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("operation_id", sa.String(), nullable=False),
        sa.Column("request_hash", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.UniqueConstraint("chapter_id", "revision"),
        sa.UniqueConstraint("chapter_id", "operation_id"))
    op.create_index("ix_outline_revisions_novel_id", "outline_revisions", ["novel_id"])
    op.create_index("ix_outline_revisions_chapter_id", "outline_revisions", ["chapter_id"])


def downgrade():
    op.drop_table("outline_revisions")
    op.drop_column("chapters", "outline_revision")
