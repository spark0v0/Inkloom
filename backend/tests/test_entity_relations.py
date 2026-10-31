import pytest

from app import schemas as dto
from app.context import build_context
from app.domain import DomainError


def test_relation_crud(library):
    novel = library.create_novel(dto.NovelInput(title="关系测试作品"))

    # Create two characters
    c1 = library.put_entity(novel.id, dto.EntityInput(kind="character", name="苏凌", summary="主角"))
    c2 = library.put_entity(novel.id, dto.EntityInput(kind="character", name="白清雪", summary="玄霜峰圣女"))
    c3 = library.put_entity(novel.id, dto.EntityInput(kind="character", name="幽冥殿主", summary="魔道巨擘"))

    # Create relation
    rel = library.create_relation(
        novel.id,
        dto.RelationInput(
            source_id=c1.id,
            target_id=c2.id,
            relation_type="道侣",
            description="青梅竹马，生死相依",
            bidirectional=True,
        ),
    )
    assert rel.source_id == c1.id
    assert rel.target_id == c2.id
    assert rel.source_name == "苏凌"
    assert rel.target_name == "白清雪"
    assert rel.relation_type == "道侣"

    # Query relations for novel
    all_rels = library.relations(novel.id)
    assert len(all_rels) == 1

    # Query relations filtered by entity c1 and c2
    c1_rels = library.relations(novel.id, entity_id=c1.id)
    assert len(c1_rels) == 1
    c2_rels = library.relations(novel.id, entity_id=c2.id)
    assert len(c2_rels) == 1
    c3_rels = library.relations(novel.id, entity_id=c3.id)
    assert len(c3_rels) == 0

    # Self-relation rejection
    with pytest.raises(DomainError) as exc_info:
        library.create_relation(
            novel.id,
            dto.RelationInput(source_id=c1.id, target_id=c1.id, relation_type="自身"),
        )
    assert exc_info.value.code == "INVALID_RELATION"

    # Duplicate relation rejection
    with pytest.raises(DomainError) as exc_info:
        library.create_relation(
            novel.id,
            dto.RelationInput(source_id=c1.id, target_id=c2.id, relation_type="道侣"),
        )
    assert exc_info.value.code == "RELATION_EXISTS"

    # Update relation
    updated = library.update_relation(
        novel.id,
        rel.id,
        dto.RelationUpdate(description="青梅竹马，因九品玄丹之争暗生嫌隙"),
    )
    assert updated.description == "青梅竹马，因九品玄丹之争暗生嫌隙"

    # Delete relation
    library.delete_relation(novel.id, rel.id)
    assert len(library.relations(novel.id)) == 0


def test_relation_context_injection(library, generation):
    novel = library.create_novel(dto.NovelInput(title="关系注水测试"))
    # Create two characters and link them
    c1 = library.put_entity(
        novel.id,
        dto.EntityInput(kind="character", name="萧炎", summary="主角", aliases=["炎帝"]),
    )
    c2 = library.put_entity(
        novel.id,
        dto.EntityInput(kind="character", name="纳兰嫣然", summary="云岚宗少宗主"),
    )
    library.create_relation(
        novel.id,
        dto.RelationInput(
            source_id=c1.id,
            target_id=c2.id,
            relation_type="退婚宿敌",
            description="三年之约，立誓上云岚宗雪耻",
            bidirectional=True,
        ),
    )

    # Creating chapter with goal mentioning both characters auto-pins them
    chapter = library.create_chapter(
        novel.id,
        dto.ChapterInput(title="第1章 坊市风波", goal="萧炎与纳兰嫣然在坊市爆发争执"),
    )

    with library.ws.session() as s:
        ctx = build_context(
            s,
            novel.id,
            dto.ContextInput(
                chapter_id=chapter.id,
                base_version_id=chapter.working_version_id,
                task="continue",
                target_chars=800,
                provider_id="demo",
            ),
        )
        # Verify character_relations is injected in preview and messages
        assert len(ctx["preview"]["character_relations"]) == 1
        rel = ctx["preview"]["character_relations"][0]
        assert rel["relation_type"] == "退婚宿敌"
        assert rel["source_name"] == "萧炎"
        assert rel["target_name"] == "纳兰嫣然"

        # Check that user prompt JSON message has character_relations
        user_msg = ctx["messages"][1]["content"]
        assert "退婚宿敌" in user_msg
        assert "三年之约" in user_msg
