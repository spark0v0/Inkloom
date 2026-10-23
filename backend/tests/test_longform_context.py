import pytest

from app import schemas as dto
from app.domain import DomainError, uid
from app.models import Plan, Provider


def confirmed(library, novel_id, title, text):
    chapter = library.create_chapter(novel_id, dto.ChapterInput(title=title))
    version = library.save(novel_id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id, operation_id=uid("save"), text=text))
    library.confirm(novel_id, chapter.id, dto.CanonInput(
        version_id=version.id, operation_id=uid("confirm")))
    return chapter, version


def test_old_character_alias_recalls_sources_after_many_new_settings(library, generation):
    novel = library.create_novel(dto.NovelInput(title="长篇人物检索"))
    hero = library.put_entity(novel.id, dto.EntityInput(
        kind="character", name="林舟", aliases=["渡鸦"], summary="左手受伤的领航员"))
    for i in range(65):
        library.put_entity(novel.id, dto.EntityInput(kind="character", name=f"路人{i}"))
    _, original = confirmed(library, novel.id, "旧事", "林舟的左手受伤，再也不能握剑。")
    confirmed(library, novel.id, "途经", "船队经过一座荒岛。")
    confirmed(library, novel.id, "抵达", "船队终于靠岸。")
    current = library.create_chapter(novel.id, dto.ChapterInput(title="重逢", goal="渡鸦尝试拔剑"))
    preview = generation.preview(novel.id, dto.ContextInput(chapter_id=current.id,
        base_version_id=current.working_version_id, task="continue"))
    assert hero.id in {e.id for e in preview.entities}
    assert any(s.version_id == original.id for s in preview.sources)
    assert any("设定" in notice and "未纳入" in notice for notice in preview.notices)


def test_chapter_goal_retrieves_short_chinese_terms_without_entity(library, generation):
    novel = library.create_novel(dto.NovelInput(title="短词检索"))
    _, original = confirmed(library, novel.id, "约定", "玄令只能使用一次。")
    confirmed(library, novel.id, "旅途", "商队出发。")
    confirmed(library, novel.id, "抵达", "商队抵达城门。")
    current = library.create_chapter(novel.id, dto.ChapterInput(title="新章", goal="玄令"))
    preview = generation.preview(novel.id, dto.ContextInput(chapter_id=current.id,
        base_version_id=current.working_version_id, task="continue"))
    assert any(s.version_id == original.id for s in preview.sources)


def test_retrieval_filters_future_and_foreign_sources_before_limit(library, generation):
    novel = library.create_novel(dto.NovelInput(title="本书"))
    other = library.create_novel(dto.NovelInput(title="另一本书"))
    _, foreign = confirmed(library, other.id, "异书", "玄令属于另一本书。")
    _, original = confirmed(library, novel.id, "过去", "玄令只能使用一次。")
    confirmed(library, novel.id, "中间一", "继续前行。")
    confirmed(library, novel.id, "中间二", "再次启程。")
    current, current_version = confirmed(library, novel.id, "当前", "此时仍不知道将来。")
    # Reviewing an earlier chapter must never use later confirmed text as past knowledge.
    _, version = confirmed(library, novel.id, "未来",
        "\n\n".join(f"玄令的未来用途{i}。" for i in range(35)))
    request = dto.ContextInput(chapter_id=current.id, base_version_id=current_version.id,
        task="review", instruction="玄令")
    preview = generation.preview(novel.id, request)
    assert any(s.version_id == original.id for s in preview.sources)
    assert not any(s.version_id in {foreign.id, version.id} for s in preview.sources)
    excluded = generation.preview(novel.id, request.model_copy(update={
        "excluded_source_ids": [f"{original.id}:{original.paragraphs[0].paragraph_id}"]}))
    assert not any(s.version_id == original.id for s in excluded.sources)


def test_world_rules_survive_recency_limit_and_budget_still_blocks(library, generation):
    novel = library.create_novel(dto.NovelInput(title="世界规则"))
    rule = library.put_entity(novel.id, dto.EntityInput(kind="world", name="世界硬约束", body="人死不能复生。"))
    for i in range(61):
        library.put_entity(novel.id, dto.EntityInput(kind="character", name=f"人物{i}"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="第一章"))
    request = dto.ContextInput(chapter_id=chapter.id, base_version_id=chapter.working_version_id, task="continue")
    assert rule.id in {e.id for e in generation.preview(novel.id, request).entities}
    # Oversized required settings fail locally; the budget is not evaded by truncating rules.
    for i in range(10):
        library.put_entity(novel.id, dto.EntityInput(kind="world", name=f"必要规则{i}", body="不可更改。" * 1500))
    with library.ws.session(write=True) as session:
        session.get(Provider, "demo").context_window = 16000
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, request)
    assert error.value.code == "CONTEXT_TOO_LARGE"


def test_current_chapter_plan_activates_alias_but_future_plan_does_not(library, generation):
    novel = library.create_novel(dto.NovelInput(title="细纲检索"))
    hero = library.put_entity(novel.id, dto.EntityInput(kind="character", name="林舟", aliases=["渡鸦"]))
    for i in range(62):
        library.put_entity(novel.id, dto.EntityInput(kind="character", name=f"配角{i}"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="当前章"))
    future = library.create_chapter(novel.id, dto.ChapterInput(title="后续章"))
    plan = library.put_plan(novel.id, dto.PlanInput(level="chapter", title="后续细纲", body="渡鸦登场"))
    with library.ws.session(write=True) as session:
        session.get(Plan, plan.id).structure = {"chapter_id": future.id}
    request = dto.ContextInput(chapter_id=chapter.id, base_version_id=chapter.working_version_id, task="continue")
    assert hero.id not in {e.id for e in generation.preview(novel.id, request).entities}
    with library.ws.session(write=True) as session:
        session.get(Plan, plan.id).structure = {"chapter_id": chapter.id}
    assert hero.id in {e.id for e in generation.preview(novel.id, request).entities}
