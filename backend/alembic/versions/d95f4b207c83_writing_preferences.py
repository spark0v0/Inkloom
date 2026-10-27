"""Per-novel writing preferences; existing prose and style text are preserved."""
import sqlalchemy as sa

from alembic import op

revision = "d95f4b207c83"
down_revision = "c84e3a190b72"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("novels", sa.Column("writing_preferences", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade():
    op.drop_column("novels", "writing_preferences")
