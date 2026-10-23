"""Add serial targets and structured volume planning without changing existing drafts."""

import sqlalchemy as sa

from alembic import op

revision = "a12c7e604bc9"
down_revision = "924486b5f963"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("novels", sa.Column("platform", sa.String(40), server_default="番茄小说", nullable=False))
    op.add_column("novels", sa.Column("target_words", sa.Integer(), server_default="1000000", nullable=False))
    op.add_column("novels", sa.Column("chapter_words", sa.Integer(), server_default="2000", nullable=False))
    op.add_column("plans", sa.Column("parent_id", sa.String(), nullable=True))
    op.add_column("plans", sa.Column("structure", sa.JSON(), server_default="{}", nullable=False))


def downgrade():
    op.drop_column("plans", "structure")
    op.drop_column("plans", "parent_id")
    op.drop_column("novels", "chapter_words")
    op.drop_column("novels", "target_words")
    op.drop_column("novels", "platform")
