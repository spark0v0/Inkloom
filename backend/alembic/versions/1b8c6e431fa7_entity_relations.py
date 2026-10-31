"""Entity relationships table for character network and context grounding."""
import sqlalchemy as sa
from alembic import op

revision = "1b8c6e431fa7"
down_revision = "f17b6d429ea5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "entity_relations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("novel_id", sa.String(), sa.ForeignKey("novels.id"), nullable=False),
        sa.Column("source_id", sa.String(), sa.ForeignKey("entities.id"), nullable=False),
        sa.Column("target_id", sa.String(), sa.ForeignKey("entities.id"), nullable=False),
        sa.Column("relation_type", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("bidirectional", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )
    op.create_index("ix_entity_relations_novel_id", "entity_relations", ["novel_id"])
    op.create_index("ix_entity_relations_source_id", "entity_relations", ["source_id"])
    op.create_index("ix_entity_relations_target_id", "entity_relations", ["target_id"])
    op.create_index(
        "uq_entity_relation_pair",
        "entity_relations",
        ["novel_id", "source_id", "target_id", "relation_type"],
        unique=True,
    )


def downgrade():
    op.drop_index("uq_entity_relation_pair", table_name="entity_relations")
    op.drop_index("ix_entity_relations_target_id", table_name="entity_relations")
    op.drop_index("ix_entity_relations_source_id", table_name="entity_relations")
    op.drop_index("ix_entity_relations_novel_id", table_name="entity_relations")
    op.drop_table("entity_relations")
