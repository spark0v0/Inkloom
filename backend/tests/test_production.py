import asyncio
import hashlib
import io
import json
import sqlite3
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest
from alembic.config import Config
from sqlalchemy import create_engine

from alembic import command
from app import schemas as dto
from app.context import validate_result
from app.domain import DomainError, uid
from app.library import Library
from app.models import Job
from app.providers import StreamPart, demo_text
from app.storage import BACKEND_DIR, Workspace
from app.workspace_io import activate_restore, restore


@pytest.fixture(autouse=True)
def instant_demo(monkeypatch):
    async def complete(config, key, messages, task, context):
        yield StreamPart(text=demo_text(task, context))
        yield StreamPart(finish="stop")
    monkeypatch.setattr("app.jobs.stream_completion", complete)


def execute(generation, job):
    claimed = generation.claim()
    assert claimed is not None
    asyncio.run(generation._execute(*claimed))
    return generation.get(job.novel_id, job.id)


def create(library, generation):
    novel = library.create_novel(dto.NovelInput(title="连载测试", premise="归乡者收到失踪家人的信",
        platform="起点中文网", target_words=1000000, chapter_words=2500))
    anchor = library.chapter(novel.id, library.planning_anchor(novel.id).chapter_id)
    job = generation.create(novel.id, dto.JobInput(chapter_id=anchor.id,
        base_version_id=anchor.working_version_id, task="blueprint", idempotency_key=uid("blueprint")))
    return novel, anchor, job


def blueprint(library, generation):
    novel, anchor, job = create(library, generation)
    finished = execute(generation, job)
    assert finished.state == "succeeded", finished.error_message
    generation.apply_plan(novel.id, job.id)
    volume = next(p for p in library.plans(novel.id) if p.level == "volume")
    return novel, anchor, volume


def outline(library, generation, novel, anchor, volume, count=3):
    current = library.chapter(novel.id, anchor.id)
    job = generation.create(novel.id, dto.JobInput(chapter_id=anchor.id,
        base_version_id=current.working_version_id, task="outline", volume_plan_id=volume.id,
        chapter_batch=count, idempotency_key=uid("outline")))
    finished = execute(generation, job)
    assert finished.state == "succeeded", finished.error_message
    return finished


def test_outline_resume_keeps_the_requested_volume_in_new_and_old_snapshots(library, generation, workspace):

    novel, anchor, first = blueprint(library, generation)
    second = library.put_plan(novel.id, dto.PlanInput(title='第二卷', level='volume', body='新的航程。'))
    job = generation.create(novel.id, dto.JobInput(chapter_id=anchor.id,
        base_version_id=anchor.working_version_id, task='outline', volume_plan_id=second.id,
        idempotency_key=uid('outline')))
    assert job.context.volume_plan_id == second.id != first.id
    assert generation.history(novel_id=novel.id, volume_plan_id=first.id).items == []
    assert generation.history(novel_id=novel.id, volume_plan_id=second.id).items[0].id == job.id
    with workspace.session(write=True) as session:
        row = session.get(Job, job.id)
        snapshot = json.loads(json.dumps(row.context))
        snapshot['preview'].pop('volume_plan_id')
        row.context = snapshot
    assert generation.get(novel.id, job.id).context.volume_plan_id == second.id


def test_book_to_chapter_to_memory_and_next_chapter(library, generation):
    novel, anchor, job = create(library, generation)
    assert library.plans(novel.id) == []
    finished = execute(generation, job)
    assert finished.result.kind == "blueprint"
    assert library.plans(novel.id) == []  # Receiving a model response never mutates author data.
    applied = generation.apply_plan(novel.id, job.id)
    assert generation.apply_plan(novel.id, job.id) == applied
    assert len(library.entities(novel.id)) == 3
    assert len(library.plans(novel.id)) == 4
    assert library.facts(novel.id) == []  # Future plans are not canon.
    volume = next(p for p in library.plans(novel.id) if p.level == "volume")
    planned = outline(library, generation, novel, anchor, volume)
    selected = generation.apply_plan(novel.id, planned.id)
    assert generation.apply_plan(novel.id, planned.id) == selected
    chapters = library.chapters(novel.id)
    assert len(chapters) == 3 and chapters[0].id == anchor.id
    assert [c.position for c in chapters] == [1, 2, 3]
    assert all(c.char_count == 0 and c.goal for c in chapters)
    draft = execute(generation, generation.create(novel.id, dto.JobInput(chapter_id=anchor.id,
        base_version_id=anchor.working_version_id, task="continue", idempotency_key=uid("draft"))))
    saved = generation.adopt(novel.id, draft.id, anchor.working_version_id)
    extracted = execute(generation, generation.create(novel.id, dto.JobInput(chapter_id=anchor.id,
        base_version_id=saved.id, task="extract", idempotency_key=uid("memory"))))
    library.confirm(novel.id, anchor.id, dto.CanonInput(version_id=saved.id, operation_id=uid("approve"),
        changes=extracted.result.changes))
    assert library.novel(novel.id).accepted_count == 1
    next_context = generation.preview(novel.id, dto.ContextInput(chapter_id=chapters[1].id,
        base_version_id=chapters[1].working_version_id, task="continue"))
    assert any(s.version_id == saved.id for s in next_context.sources)
    assert next_context.facts
    assert next_context.author_brief["platform"] == "起点中文网"
    assert saved.text in library.export(novel.id, confirmed=True)


def test_outline_appends_batches_without_overwriting_prose(library, generation):
    novel, anchor, volume = blueprint(library, generation)
    first = outline(library, generation, novel, anchor, volume)
    generation.apply_plan(novel.id, first.id)
    chapter = library.chapter(novel.id, anchor.id)
    version = library.save(novel.id, anchor.id, dto.SaveInput(base_version_id=chapter.working_version_id,
        operation_id=uid("save"), text="不能被后续规划覆盖的正文。"))
    second = outline(library, generation, novel, anchor, volume)
    assert [c.number for c in second.result.chapters] == [4, 5, 6]
    generation.apply_plan(novel.id, second.id)
    assert len(library.chapters(novel.id)) == 6
    assert library.chapter(novel.id, anchor.id).version.id == version.id
    assert library.chapter(novel.id, anchor.id).version.text == "不能被后续规划覆盖的正文。"


@pytest.mark.parametrize("chapter_title,chapter_volume,goal", [
    ("渡口来信", "旧事", "查找寄信人"), ("第1章", "第一卷", ""),
])
def test_outline_keeps_an_authors_empty_first_chapter(library, generation, chapter_title, chapter_volume, goal):
    novel = library.create_novel(dto.NovelInput(title="从旧细纲续写"))
    first = library.create_chapter(novel.id, dto.ChapterInput(title=chapter_title, volume=chapter_volume, goal=goal))
    volume = library.put_plan(novel.id, dto.PlanInput(title=chapter_volume, level="volume"))
    job = outline(library, generation, novel, first, volume)
    generation.apply_plan(novel.id, job.id)
    chapters = library.chapters(novel.id)
    assert [c.position for c in chapters] == [1, 2, 3, 4]
    assert (chapters[0].id, chapters[0].title, chapters[0].goal) == (first.id, first.title, first.goal)


def test_planning_anchor_reuses_the_first_chapter_and_its_current_version(client):
    novel = client.post("/api/v1/novels", json={"title": "重复准备开书"}).json()
    base = f"/api/v1/novels/{novel['id']}"
    with ThreadPoolExecutor(max_workers=2) as pool:
        requests = [pool.submit(client.post, base + "/planning-anchor") for _ in range(2)]
        first, second = [request.result() for request in requests]
    assert first.status_code == second.status_code == 200
    anchor = first.json()
    assert second.json() == anchor
    chapter = client.post(f"{base}/chapters/{anchor['chapter_id']}/versions", json={
        "base_version_id": anchor["base_version_id"], "operation_id": uid("save"), "text": "已开始创作。",
    })
    assert chapter.status_code < 300
    assert client.post(base + "/planning-anchor").json() == {**anchor, "base_version_id": chapter.json()["id"]}
    assert len(client.get(base + "/chapters").json()) == 1


def test_legacy_candidate_cannot_replace_an_authors_first_chapter(library, generation):
    novel = library.create_novel(dto.NovelInput(title="旧规划候选"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="作者安排的第一章", goal="追查来信"))
    volume = library.put_plan(novel.id, dto.PlanInput(title=chapter.volume, level="volume"))
    job = outline(library, generation, novel, chapter, volume)
    with library.ws.session(write=True) as session:
        saved = session.get(Job, job.id)
        payload = saved.context["input"]
        production = {**payload["production"], "initial_slot": chapter.id, "start_number": 1}
        saved.context = {**saved.context, "input": {**payload, "production": production}}
    with pytest.raises(DomainError) as error:
        generation.apply_plan(novel.id, job.id)
    assert error.value.code == "CONTEXT_STALE"
    assert library.chapters(novel.id)[0].goal == chapter.goal


def test_outline_rejects_appending_an_earlier_volume_after_manual_chapters(library, generation):
    novel = library.create_novel(dto.NovelInput(title="分卷顺序"))
    early = library.put_plan(novel.id, dto.PlanInput(title="离乡", level="volume"))
    later = library.put_plan(novel.id, dto.PlanInput(title="重逢", level="volume"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="见到故人", volume=later.title))
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, dto.ContextInput(chapter_id=chapter.id, base_version_id=chapter.working_version_id,
            task="outline", volume_plan_id=early.id))
    assert error.value.code == "VOLUME_ORDER"


def test_existing_volume_order_follows_chapters_when_plans_were_added_in_reverse(library, generation):
    novel = library.create_novel(dto.NovelInput(title="已有手稿补规划"))
    later = library.put_plan(novel.id, dto.PlanInput(title="远航", level="volume"))
    earlier = library.put_plan(novel.id, dto.PlanInput(title="旧渡口", level="volume"))
    first = library.create_chapter(novel.id, dto.ChapterInput(title="来信", volume=earlier.title))
    library.create_chapter(novel.id, dto.ChapterInput(title="离港", volume=later.title))
    request = dto.ContextInput(chapter_id=first.id, base_version_id=first.working_version_id,
        task="outline", volume_plan_id=earlier.id)
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, request)
    assert error.value.code == "VOLUME_ORDER"
    generation.preview(novel.id, request.model_copy(update={"volume_plan_id": later.id}))


def test_catalog_change_prevents_late_plan_adoption(library, generation):
    novel, anchor, volume = blueprint(library, generation)
    job = outline(library, generation, novel, anchor, volume)
    library.create_chapter(novel.id, dto.ChapterInput(title="作者新加的章节"))
    with pytest.raises(DomainError) as error:
        generation.apply_plan(novel.id, job.id)
    assert error.value.code == "CONTEXT_STALE"
    assert len(library.chapters(novel.id)) == 2


def test_outline_validates_volume_scope_count_and_numbering(library, generation):
    novel, anchor, volume = blueprint(library, generation)
    other = library.create_novel(dto.NovelInput(title="另一作品"))
    foreign = library.put_plan(other.id, dto.PlanInput(title="异书分卷", level="volume"))
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, dto.ContextInput(chapter_id=anchor.id,
            base_version_id=anchor.working_version_id, task="outline", volume_plan_id=foreign.id))
    assert error.value.code == "VOLUME_NOT_FOUND"
    job = outline(library, generation, novel, anchor, volume)
    with generation.ws.session() as session:
        context = session.get(Job, job.id).context
    bad = job.result.model_dump()
    bad["chapters"][0]["number"] = 2
    with pytest.raises(DomainError) as error:
        validate_result("outline", bad, context)
    assert error.value.code == "INVALID_OUTLINE"
    assert len(library.chapters(novel.id)) == 1


def test_plan_edit_and_chapter_edit_share_the_same_goal(library, generation):
    novel, anchor, volume = blueprint(library, generation)
    job = outline(library, generation, novel, anchor, volume)
    generation.apply_plan(novel.id, job.id)
    library.edit_chapter(novel.id, anchor.id, dto.ChapterPatch(goal="作者修改的剧情", title="新标题"))
    plan = next(p for p in library.plans(novel.id) if p.structure.get("chapter_id") == anchor.id)
    assert (plan.title, plan.body) == ("新标题", "作者修改的剧情")
    library.put_plan(novel.id, dto.PlanInput(title="再次编辑", level="chapter", body="新的细纲"), plan.id)
    assert library.chapter(novel.id, anchor.id).goal == "新的细纲"
    library.put_plan(novel.id, dto.PlanInput(title="第一卷 新名", level="volume", body=volume.body), volume.id)
    assert {c.volume for c in library.chapters(novel.id)} == {"第一卷 新名"}


def test_serial_export_omits_plans_and_unsafe_filenames(library):
    novel = library.create_novel(dto.NovelInput(title="导出作品"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="../../第一章:回家"))
    version = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
        operation_id=uid("save"), text="正文😀。\n\n第二段。"))
    library.create_chapter(novel.id, dto.ChapterInput(title="第二章 尚未创作"))
    library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id, operation_id=uid("approve")))
    with zipfile.ZipFile(io.BytesIO(library.export_chapters(novel.id))) as archive:
        assert len(archive.namelist()) == 1
        assert "/" not in archive.namelist()[0] and "\\" not in archive.namelist()[0]
        assert "正文😀。" in archive.read(archive.namelist()[0]).decode("utf-8")
    assert "尚未创作" not in library.export(novel.id, confirmed=False)


def test_invalid_ai_outline_and_cancelled_plan_never_create_chapters(library, generation, monkeypatch):
    novel, anchor, volume = blueprint(library, generation)

    async def malformed(config, key, messages, task, context):
        body = json.loads(demo_text(task, context))
        body["chapters"][0]["number"] = 999
        yield StreamPart(text=json.dumps(body, ensure_ascii=False))
        yield StreamPart(finish="stop")

    monkeypatch.setattr("app.jobs.stream_completion", malformed)
    requested = generation.create(novel.id, dto.JobInput(chapter_id=anchor.id,
        base_version_id=anchor.working_version_id, task="outline", volume_plan_id=volume.id,
        chapter_batch=3, idempotency_key=uid("invalid-plan")))
    failed = execute(generation, requested)
    assert failed.state == "failed" and failed.error_code == "INVALID_STRUCTURED_OUTPUT"
    with pytest.raises(DomainError):
        generation.apply_plan(novel.id, failed.id)
    cancel = generation.create(novel.id, dto.JobInput(chapter_id=anchor.id,
        base_version_id=anchor.working_version_id, task="outline", volume_plan_id=volume.id,
        idempotency_key=uid("cancel-plan")))
    generation.control(novel.id, cancel.id, "cancel")
    assert generation.claim() is None
    with pytest.raises(DomainError):
        generation.apply_plan(novel.id, cancel.id)
    assert len(library.chapters(novel.id)) == 1


def test_context_scales_by_selected_volume_and_keeps_older_relevant_memory(library, generation):
    novel, anchor, volume = blueprint(library, generation)
    for i in range(15):
        library.put_plan(novel.id, dto.PlanInput(title=f"未来卷{i}", level="volume", body="未来情节暂不进入当前卷。" * 150))
    request = dto.JobInput(chapter_id=anchor.id, base_version_id=anchor.working_version_id,
        task="outline", volume_plan_id=volume.id, chapter_batch=3, idempotency_key=uid("scope-context"))
    preview = generation.preview(novel.id, request)
    assert {p.level for p in preview.plans} == {"book", "volume"}
    assert len(preview.plans) == 2
    assert all(not p.structure for p in preview.plans)
    assert preview.estimated_input_tokens < 16000
    library.put_entity(novel.id, dto.EntityInput(kind="world", name="玄令", summary="有次数限制的信物"))
    lines = ["玄令用过一次后就会失效。"] + [f"事件{i}已经结束。" for i in range(99)]
    version = library.save(novel.id, anchor.id, dto.SaveInput(base_version_id=anchor.working_version_id,
        operation_id=uid("many-facts"), text="\n\n".join(lines)))
    changes = [dto.MemoryProposal(kind="state", subject="玄令" if i == 0 else "事件",
        claim=p.text, evidence=[dto.Evidence(source_id=f"{version.id}:{p.paragraph_id}", quote=p.text)])
        for i, p in enumerate(version.paragraphs)]
    library.confirm(novel.id, anchor.id, dto.CanonInput(version_id=version.id, operation_id=uid("confirm"), changes=changes))
    next_chapter = library.create_chapter(novel.id, dto.ChapterInput(title="第二章", goal="主角尝试使用玄令"))
    recalled = generation.preview(novel.id, dto.ContextInput(chapter_id=next_chapter.id,
        base_version_id=next_chapter.working_version_id, task="continue"))
    assert any(f.subject == "玄令" for f in recalled.facts)


@pytest.mark.parametrize("old_revision", ["924486b5f963", "a12c7e604bc9", "e06a5c318d94"])
def test_old_workspace_migrates_and_old_backup_restores(tmp_path, workspace, old_revision):
    root = tmp_path / "old-workspace"
    old = Workspace(root)
    lib = Library(old)
    novel = lib.create_novel(dto.NovelInput(title="旧版本作品"))
    chapter = lib.create_chapter(novel.id, dto.ChapterInput(title="旧章节"))
    lib.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
        operation_id=uid("old-save"), text="旧稿和段落引用必须保留。"))
    old.close()
    engine = create_engine("sqlite:///" + (root / "workspace.db").as_posix())
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, old_revision)
    engine.dispose()
    with sqlite3.connect(root / "workspace.db") as connection:
        raw = connection.serialize()
    manifest = {"format": "story-workshop-backup", "format_version": 1, "schema_revision": old_revision,
        "files": {"workspace.db": {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}}}
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("manifest.json", json.dumps(manifest))
        output.writestr("workspace.db", raw)
    restored = restore(workspace, archive.getvalue())
    activate_restore(workspace, restored["restore_id"])
    assert Library(workspace).chapter(novel.id, chapter.id).version.text == "旧稿和段落引用必须保留。"
    assert Library(workspace).novel(novel.id).chapter_words == 2000
    reopened = Workspace(root)
    try:
        assert Library(reopened).novel(novel.id).target_words == 1000000
        assert Library(reopened).chapter(novel.id, chapter.id).version.text == "旧稿和段落引用必须保留。"
    finally:
        reopened.close()
