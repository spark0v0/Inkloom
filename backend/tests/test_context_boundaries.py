"""Real SQLite regressions from the long-form workflow review; no model calls."""
import json

import pytest
from sqlalchemy import event

from app import schemas as dto
from app.context import build_context, canon_checkpoint, context_current
from app.domain import DomainError, uid
from app.models import Job, Provider


def confirm(library, novel_id, title, text, facts=1):
    chapter = library.create_chapter(novel_id, dto.ChapterInput(title=title))
    version = library.save(novel_id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id, operation_id=uid("save"), text=text))
    evidence = dto.Evidence(source_id=f"{version.id}:{version.paragraphs[0].paragraph_id}", quote=version.paragraphs[0].text)
    library.confirm(novel_id, chapter.id, dto.CanonInput(version_id=version.id, operation_id=uid("canon"),
        changes=[dto.MemoryProposal(subject=f"路标{i}", claim=version.paragraphs[0].text, evidence=[evidence]) for i in range(facts)]))
    return library.chapter(novel_id, chapter.id)


def test_outline_reads_actual_recent_canon_independent_of_mount_chapter(library, generation):
    novel = library.create_novel(dto.NovelInput(title="接续已写剧情"))
    first = confirm(library, novel.id, "第一章", "主角尚未离开故乡。")
    second = confirm(library, novel.id, "第二章", "主角已抵达北岸，决定放弃原来的航线。")
    third = confirm(library, novel.id, "第三章", "主角卖掉船只，转而调查北岸旧案。")
    # A later outline can already exist while its prose remains unconfirmed.
    draft = library.create_chapter(novel.id, dto.ChapterInput(title="第四章", goal="原计划继续远航"))
    library.save(novel.id, draft.id, dto.SaveInput(base_version_id=draft.working_version_id,
        operation_id=uid("save"), text="未定稿草稿不作为已发生剧情。"))
    library.put_plan(novel.id, dto.PlanInput(level="book", title="全书", body="调查旧案。"))
    volume = library.put_plan(novel.id, dto.PlanInput(level="volume", title="北岸", body="在北岸追查旧案。"))
    request = dto.JobInput(chapter_id=first.id, base_version_id=first.working_version_id,
        task="outline", volume_plan_id=volume.id, idempotency_key=uid("job"))
    job = generation.create(novel.id, request)
    assert {second.id, third.id} <= {s.chapter_id for s in job.context.sources}
    assert draft.id not in {s.chapter_id for s in job.context.sources}
    assert any(f.chapter_id == third.id for f in job.context.facts)
    with library.ws.session() as session:
        saved = session.get(Job, job.id)
        assert saved.context["narrative_position"] == 5
        assert saved.context["input"]["chapter"]["position"] == 5
        assert saved.context["input"]["draft_sources"] == []
        assert third.id in saved.context["canon_checkpoint"]
        assert context_current(session, saved)
    # Existing catalog/late result protections must survive the new reading range.
    library.save(novel.id, third.id, dto.SaveInput(base_version_id=third.working_version_id,
        operation_id=uid("save"), text="主角改变了决定。"))
    assert generation.claim() is None
    assert generation.get(novel.id, job.id).error_code == "CONTEXT_STALE"


def test_outline_does_not_inherit_mount_chapter_notes_or_goal(library, generation):
    novel = library.create_novel(dto.NovelInput(title="规划范围"))
    first = library.create_chapter(novel.id, dto.ChapterInput(title="首章", goal="只适用于首章的委托"))
    with library.ws.session(write=True) as session:
        from app.models import Chapter
        session.get(Chapter, first.id).references = {"notes": "只适用于首章的补充资料"}
    volume = library.put_plan(novel.id, dto.PlanInput(level="volume", title="远航", body="继续远航。"))
    with library.ws.session() as session:
        context = build_context(session, novel.id, dto.ContextInput(chapter_id=first.id,
            base_version_id=first.working_version_id, task="outline", volume_plan_id=volume.id))
    assert "reference_material" not in context["input"]
    assert context["input"]["chapter"]["goal"] != first.goal


def test_old_outline_snapshot_retains_its_original_checkpoint_scope(library, generation):
    novel = library.create_novel(dto.NovelInput(title="旧任务兼容"))
    first = confirm(library, novel.id, "第一章", "主角出发。")
    confirm(library, novel.id, "第二章", "主角抵达。")
    volume = library.put_plan(novel.id, dto.PlanInput(level="volume", title="远航", body="远航计划。"))
    job = generation.create(novel.id, dto.JobInput(chapter_id=first.id,
        base_version_id=first.working_version_id, task="outline", volume_plan_id=volume.id,
        idempotency_key=uid("old")))
    with library.ws.session(write=True) as session:
        saved = session.get(Job, job.id)
        legacy = dict(saved.context)
        legacy.pop("narrative_position")
        legacy["canon_checkpoint"] = canon_checkpoint(session, novel.id, first.position)
        saved.context = legacy
    with library.ws.session() as session:
        assert context_current(session, session.get(Job, job.id))


@pytest.mark.parametrize("instruction", ["主角尝试再次使用玄令打开城门", "主角尝试再次使用青铜钥匙打开城门"])
def test_natural_chinese_instruction_recalls_old_text_and_fact(library, generation, instruction):
    novel = library.create_novel(dto.NovelInput(title="自然细纲召回"))
    old = confirm(library, novel.id, "旧约", "玄令和青铜钥匙都只能使用一次，用后就会碎裂。")
    confirm(library, novel.id, "途中", "商队走过了许多路标。", facts=44)
    confirm(library, novel.id, "抵达", "商队在城外停下。")
    current = library.create_chapter(novel.id, dto.ChapterInput(title="第四章"))
    preview = generation.preview(novel.id, dto.ContextInput(chapter_id=current.id,
        base_version_id=current.working_version_id, task="continue", instruction=instruction))
    assert any(s.version_id == old.working_version_id for s in preview.sources)
    assert any(f.version_id == old.working_version_id for f in preview.facts)


def test_optional_settings_yield_budget_without_dropping_mandatory_settings(library, generation):
    novel = library.create_novel(dto.NovelInput(title="预算分层"))
    rule = library.put_entity(novel.id, dto.EntityInput(kind="world", name="世界规则", body="人死不能复生。"))
    hero = library.put_entity(novel.id, dto.EntityInput(kind="character", name="林舟", body="主角。"))
    for i in range(12):
        library.put_entity(novel.id, dto.EntityInput(kind="character", name=f"远方配角{i}",
            body="与本章没有关联的远方人物背景。" * 100))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="林舟归乡"))
    with library.ws.session(write=True) as session:
        provider = session.get(Provider, "demo")
        provider.context_window, provider.max_output_tokens = 16000, 2000
    with library.ws.session() as session:
        context = build_context(session, novel.id, dto.ContextInput(chapter_id=chapter.id,
            base_version_id=chapter.working_version_id, task="continue"))
    preview = dto.ContextOut(**context["preview"])
    assert {rule.id, hero.id} <= {e.id for e in preview.entities}
    assert len(preview.entities) < 14
    assert any("设定" in notice and "预算" in notice for notice in preview.notices)
    assert preview.estimated_input_tokens <= 16000 - 2000 - 1280
    assert {e.id for e in preview.entities} == {e["id"] for e in json.loads(context["messages"][1]["content"])["author_settings"]}
    # Mandatory inputs still cannot be silently shortened to force a successful request.
    library.put_entity(novel.id, dto.EntityInput(kind="world", name="更多硬约束", body="必要约束。" * 1500))
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, dto.ContextInput(chapter_id=chapter.id,
            base_version_id=chapter.working_version_id, task="continue"))
    assert error.value.code == "CONTEXT_TOO_LARGE"


def test_rare_clue_is_not_displaced_by_many_recent_generic_matches(library, generation):
    novel = library.create_novel(dto.NovelInput(title="稀有线索排序"))
    old = confirm(library, novel.id, "旧约", "玄令消耗后不能恢复。")
    noise = "\n".join(f"主角再次来到城门，巡视第{i}处岗哨。" for i in range(80))
    confirm(library, novel.id, "反复巡视", noise, facts=44)
    confirm(library, novel.id, "歇息", "商队停下休息。")
    confirm(library, novel.id, "天明", "天终于亮了。")
    current = library.create_chapter(novel.id, dto.ChapterInput(title="第五章"))
    preview = generation.preview(novel.id, dto.ContextInput(chapter_id=current.id,
        base_version_id=current.working_version_id, task="continue", instruction="主角再次使用玄令打开城门"))
    assert any(s.version_id == old.working_version_id for s in preview.sources)
    assert any(f.version_id == old.working_version_id for f in preview.facts)


def test_directory_reads_only_summaries_and_counts_in_constant_queries(library):
    novel = library.create_novel(dto.NovelInput(title="目录读取"))
    for i in range(8):
        confirm(library, novel.id, f"第{i + 1}章", "正文不应在读取目录时加载。")
    other = library.create_novel(dto.NovelInput(title="异书"))
    library.create_chapter(other.id, dto.ChapterInput(title="异书章节"))
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(library.ws.db.engine, "before_cursor_execute", capture)
    try:
        chapters = library.chapters(novel.id)
    finally:
        event.remove(library.ws.db.engine, "before_cursor_execute", capture)
    assert [c.position for c in chapters] == list(range(1, 9))
    assert all(c.char_count == len("正文不应在读取目录时加载。") for c in chapters)
    assert len(statements) <= 2
    assert not any(field in sql for sql in statements for field in
        ("versions.text", "versions.editor_doc", "versions.paragraphs"))
