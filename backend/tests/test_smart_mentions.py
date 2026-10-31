"""Smart entity mention and alias trigger verification."""
import json

from app import schemas as dto
from app.context import build_context
from app.domain import entity_terms, uid


def test_entity_terms_normalization():
    assert entity_terms("") == []
    assert entity_terms("苏凌") == ["苏凌"]
    assert entity_terms("苏凌", ["苏公子", "绝剑客"]) == ["苏凌", "苏公子", "绝剑客"]
    # Split common Chinese and English delimiters within a single alias entry
    assert entity_terms("沈砚", ["沈先生、阿砚, 老沈\n小砚/砚哥"]) == [
        "沈砚", "沈先生", "阿砚", "老沈", "小砚", "砚哥"
    ]
    # Deduplicate while preserving order
    assert entity_terms("青云宗", ["青云门", "青云宗", "本门"]) == ["青云宗", "青云门", "本门"]


def test_smart_alias_mention_auto_pins_entity_into_context(library, generation):
    novel = library.create_novel(dto.NovelInput(title="别名自动唤醒测试"))
    # Create entity with aliases
    hero = library.put_entity(novel.id, dto.EntityInput(
        kind="character",
        name="苏凌",
        summary="青云宗首席弟子",
        body="修行玄冰诀，身怀残月佩。",
        aliases=["苏公子", "苏师兄、老九"],
    ))
    mentor = library.put_entity(novel.id, dto.EntityInput(
        kind="character",
        name="清虚道人",
        summary="青云宗掌门",
        body="化神初期强者，性格严苛护短。",
        aliases=["掌门师叔", "清虚真人"],
    ))
    library.put_entity(novel.id, dto.EntityInput(
        kind="character",
        name="无关路人",
        summary="路人甲",
        body="没有任何关系的背景人物。",
        aliases=["路人"],
    ))

    # Draft only mentions the alias "苏公子" and "掌门师叔", NOT their canonical names
    long_prose_before = "客栈大堂之中人声鼎沸，各路散修皆在议论白日里的异象。\n\n" * 15
    chapter_text = f"{long_prose_before}店家连忙上前低语：'苏公子，掌门师叔方才派人送来了一封密信。'"

    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="第一章 密信", goal="打探消息"))
    version = library.save(novel.id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id,
        operation_id=uid("save"),
        text=chapter_text,
    ))

    with library.ws.session() as session:
        context = build_context(session, novel.id, dto.ContextInput(
            chapter_id=chapter.id,
            base_version_id=version.id,
            task="continue",
            provider_id="demo",
        ))

    preview = dto.ContextOut(**context["preview"])
    entity_ids = {e.id for e in preview.entities}

    # "苏凌" and "清虚道人" must be automatically recognized and present in context entities
    assert hero.id in entity_ids
    assert mentor.id in entity_ids
    sent_settings = json.loads(context["messages"][1]["content"])["author_settings"]
    sent_ids = {item["id"] for item in sent_settings}
    assert hero.id in sent_ids
    assert mentor.id in sent_ids


def test_story_search_finds_paragraphs_via_alias(library):
    novel = library.create_novel(dto.NovelInput(title="搜索别名测试"))
    library.put_entity(novel.id, dto.EntityInput(
        kind="character",
        name="沈砚",
        summary="主角",
        aliases=["沈先生、阿砚"],
    ))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="引子"))
    version = library.save(novel.id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id,
        operation_id=uid("save"),
        text="掌柜的见到来人，躬身行礼道：'阿砚，货已经备齐了。'",
    ))
    library.confirm(novel.id, chapter.id, dto.CanonInput(
        version_id=version.id,
        operation_id=uid("canon"),
        changes=[],
    ))

    # Searching with canonical name "沈砚" should find the paragraph where alias "阿砚" appeared
    results = library.search(novel.id, "沈砚")
    assert len(results) > 0
    assert any(r.source.version_id == version.id for r in results)
