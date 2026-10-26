"""Thread plans stay separate from evidence and respect narrative/version boundaries."""
import hashlib
import io
import json
import sqlite3
import zipfile

import pytest

from app import schemas as dto
from app.context import context_current
from app.domain import DomainError, uid
from app.models import Job
from app.threads import ThreadTracking
from app.workspace_io import activate_restore, backup, restore


def setup(library):
    novel = library.create_novel(dto.NovelInput(title="伏笔跟进"))
    chapters = []
    for title, text in [("埋设", "断裂的罗盘无法指路🙂。\n\n他向商队问路。"), ("推进", "商人认出背面的刻印。"), ("揭晓", "未来答案：罗盘来自北岸密库。")]:
        chapter = library.create_chapter(novel.id, dto.ChapterInput(title=title))
        version = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
            operation_id=uid("save"), text=text))
        library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id, operation_id=uid("canon")))
        chapters.append(library.chapter(novel.id, chapter.id))
    future = library.create_chapter(novel.id, dto.ChapterInput(title="后续"))
    chapters.append(library.chapter(novel.id, future.id))
    entity = library.put_entity(novel.id, dto.EntityInput(kind="thread", name="旧物来历", summary="作者的设想，不是已经发生的事。"))
    return novel, entity, chapters, ThreadTracking(library.ws)


def progress(tracking, novel, entity, chapter, stage, paragraph=0):
    current = tracking.list(novel.id)[0]
    p = chapter.version.paragraphs[paragraph]
    return dto.ThreadProgressInput(base_revision=current.revision, operation_id=uid("link"),
        chapter_id=chapter.id, version_id=chapter.version.id, stage=stage,
        evidence=dto.Evidence(source_id=f"{chapter.version.id}:{p.paragraph_id}", quote=p.text))


def test_lifecycle_and_read_only_plans(library):
    novel, entity, chapters, tracking = setup(library)
    plan = tracking.save_plan(novel.id, entity.id, dto.ThreadPlanInput(base_revision=0,
        target_chapter_id=chapters[2].id, intent="届时解释旧物来历"))
    assert plan.status == "planned" and plan.progress == []
    assert library.facts(novel.id) == []
    original = [c.version.text for c in chapters]
    for chapter, stage in zip(chapters[:3], ["planted", "advanced", "resolved"], strict=True):
        view = tracking.add(novel.id, entity.id, progress(tracking, novel, entity, chapter, stage))
        assert view.status == stage
        assert view.progress[-1].valid
        assert view.progress[-1].evidence.version_id == chapter.version.id
    assert [library.chapter(novel.id, c.id).version.text for c in chapters] == original
    resolved = view.progress[-1]
    reopened = tracking.change(novel.id, entity.id, resolved.id, dto.ThreadProgressChange(base_revision=view.revision, voided=True))
    assert reopened.status == "advanced" and reopened.progress[-1].voided
    recovered = tracking.change(novel.id, entity.id, resolved.id, dto.ThreadProgressChange(base_revision=reopened.revision, voided=False))
    assert recovered.status == "resolved"


def test_concurrent_plan_and_idempotent_progress(library):
    novel, entity, chapters, tracking = setup(library)
    request = progress(tracking, novel, entity, chapters[0], "planted")
    first = tracking.add(novel.id, entity.id, request)
    again = tracking.add(novel.id, entity.id, request)
    assert again.revision == first.revision and len(again.progress) == 1
    with pytest.raises(DomainError) as conflict:
        tracking.save_plan(novel.id, entity.id, dto.ThreadPlanInput(base_revision=0, intent="旧窗口"))
    assert conflict.value.code == "THREAD_CONFLICT"
    with pytest.raises(DomainError) as reused:
        tracking.add(novel.id, entity.id, request.model_copy(update={"note": "不同内容"}))
    assert reused.value.code == "OPERATION_REUSED"


@pytest.mark.parametrize("stage", ["advanced", "resolved"])
def test_progress_requires_earlier_planting(library, stage):
    novel, entity, chapters, tracking = setup(library)
    with pytest.raises(DomainError) as error:
        tracking.add(novel.id, entity.id, progress(tracking, novel, entity, chapters[1], stage))
    assert error.value.code == "THREAD_ORDER"
    assert tracking.list(novel.id)[0].progress == []


def test_same_chapter_uses_paragraph_order_not_click_order(library):
    novel, entity, chapters, tracking = setup(library)
    tracking.add(novel.id, entity.id, progress(tracking, novel, entity, chapters[0], "planted", 1))
    with pytest.raises(DomainError):
        tracking.add(novel.id, entity.id, progress(tracking, novel, entity, chapters[0], "resolved", 0))


def test_restoring_old_planting_cannot_invalidate_its_replacement(library):
    novel, entity, chapters, tracking = setup(library)
    original = tracking.add(novel.id, entity.id, progress(tracking, novel, entity, chapters[0], "planted"))
    original_id = original.progress[0].id
    tracking.change(novel.id, entity.id, original_id, dto.ThreadProgressChange(base_revision=original.revision, voided=True))
    replacement = tracking.add(novel.id, entity.id, progress(tracking, novel, entity, chapters[1], "planted"))
    with pytest.raises(DomainError) as error:
        tracking.change(novel.id, entity.id, original_id, dto.ThreadProgressChange(base_revision=replacement.revision, voided=False))
    assert error.value.code == "THREAD_ORDER"
    assert tracking.list(novel.id)[0].model_dump() == replacement.model_dump()


def test_stale_sources_and_withdrawal_do_not_claim_resolution(library):
    novel, entity, chapters, tracking = setup(library)
    for chapter, stage in [(chapters[0], "planted"), (chapters[2], "resolved")]:
        view = tracking.add(novel.id, entity.id, progress(tracking, novel, entity, chapter, stage))
    library.save(novel.id, chapters[0].id, dto.SaveInput(base_version_id=chapters[0].version.id,
        operation_id=uid("edit"), text="罗盘没有损坏。"))
    stale = tracking.list(novel.id)[0]
    assert stale.status == "needs_review" and not any(p.valid for p in stale.progress)
    assert len(stale.progress) == 2
    for item in stale.progress:
        stale = tracking.change(novel.id, entity.id, item.id, dto.ThreadProgressChange(base_revision=stale.revision, voided=True))
    assert stale.status == "planned" and len(stale.progress) == 2
    with pytest.raises(DomainError):
        tracking.change(novel.id, entity.id, view.progress[0].id, dto.ThreadProgressChange(base_revision=stale.revision, voided=False))


def test_cross_book_wrong_quote_and_draft_are_rejected(library):
    novel, entity, chapters, tracking = setup(library)
    other = library.create_novel(dto.NovelInput(title="异书"))
    foreign = library.create_chapter(other.id, dto.ChapterInput(title="异书章节"))
    with pytest.raises(DomainError):
        tracking.save_plan(novel.id, entity.id, dto.ThreadPlanInput(base_revision=0, target_chapter_id=foreign.id))
    request = progress(tracking, novel, entity, chapters[0], "planted")
    with pytest.raises(DomainError):
        tracking.add(other.id, entity.id, request)
    with pytest.raises(DomainError):
        tracking.add(novel.id, entity.id, request.model_copy(update={"evidence": dto.Evidence(source_id=request.evidence.source_id, quote="不存在的原文")}))
    with pytest.raises(DomainError) as draft:
        tracking.add(novel.id, entity.id, request.model_copy(update={"chapter_id": chapters[3].id, "version_id": chapters[3].version.id}))
    assert draft.value.code == "THREAD_SOURCE_STALE"


def test_context_is_as_of_current_chapter_and_due_plans_are_not_facts(library, generation, workspace):
    novel, entity, chapters, tracking = setup(library)
    tracking.save_plan(novel.id, entity.id, dto.ThreadPlanInput(base_revision=0,
        target_chapter_id=chapters[1].id, intent="作者未来安排：追查刻印"))
    for chapter, stage in [(chapters[0], "planted"), (chapters[2], "resolved")]:
        tracking.add(novel.id, entity.id, progress(tracking, novel, entity, chapter, stage))
    request = dto.JobInput(task="review", chapter_id=chapters[1].id, base_version_id=chapters[1].version.id, idempotency_key=uid("job"))
    job = generation.create(novel.id, request)
    guide = job.context.thread_guidance[0]
    assert guide.status == "planted" and guide.due
    assert "未来答案" not in guide.model_dump_json()
    assert [p.chapter_id for p in guide.progress] == [chapters[0].id]
    assert any(s.source_id == guide.progress[0].evidence.source_id and s.pinned for s in job.context.sources)
    assert job.context.facts == []
    with workspace.session() as session:
        stored = session.get(Job, job.id)
        assert "thread_guidance" in json.loads(stored.context["messages"][-1]["content"])
        assert context_current(session, stored)
    current = tracking.list(novel.id)[0]
    tracking.save_plan(novel.id, entity.id, dto.ThreadPlanInput(base_revision=current.revision, paused=True))
    with workspace.session() as session:
        assert not context_current(session, session.get(Job, job.id))
    assert generation.preview(novel.id, request).thread_guidance == []


def test_tracking_round_trips_backup(library, workspace):
    novel, entity, chapters, tracking = setup(library)
    before = tracking.add(novel.id, entity.id, progress(tracking, novel, entity, chapters[0], "planted"))
    recovered = restore(workspace, backup(workspace))
    activate_restore(workspace, recovered["restore_id"])
    assert tracking.list(novel.id)[0].model_dump() == before.model_dump()


def mutate_backup(workspace, tmp_path, mutate, revision=None):
    with zipfile.ZipFile(io.BytesIO(backup(workspace))) as archive:
        manifest, raw = json.loads(archive.read("manifest.json")), archive.read("workspace.db")
    path = tmp_path / "thread-backup.db"
    path.write_bytes(raw)
    with sqlite3.connect(path) as connection:
        mutate(connection)
        connection.commit()
        changed = connection.serialize()
    if revision:
        manifest["schema_revision"] = revision
    manifest["files"]["workspace.db"] = {"bytes": len(changed), "sha256": hashlib.sha256(changed).hexdigest()}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("workspace.db", changed)
    return output.getvalue()


def test_previous_schema_backup_upgrades_without_touching_prose(library, workspace, tmp_path):
    novel, _, chapters, tracking = setup(library)
    def old_schema(connection):
        connection.execute("DROP TABLE thread_progress")
        connection.execute("DROP TABLE thread_tracks")
        connection.execute("UPDATE alembic_version SET version_num='b73d2f809a61'")
    contents = mutate_backup(workspace, tmp_path, old_schema, "b73d2f809a61")
    result = restore(workspace, contents)
    activate_restore(workspace, result["restore_id"])
    assert tracking.list(novel.id)[0].status == "planned"
    assert library.chapter(novel.id, chapters[0].id).version.text == chapters[0].version.text


def test_backup_rejects_cross_book_target(library, workspace, tmp_path):
    novel, entity, _, tracking = setup(library)
    other = library.create_novel(dto.NovelInput(title="异书"))
    chapter = library.create_chapter(other.id, dto.ChapterInput())
    tracking.save_plan(novel.id, entity.id, dto.ThreadPlanInput(base_revision=0))
    content = mutate_backup(workspace, tmp_path, lambda connection: connection.execute(
        "UPDATE thread_tracks SET target_chapter_id=?", (chapter.id,)))
    original = workspace.db.workspace_id
    with pytest.raises(DomainError):
        restore(workspace, content)
    assert workspace.db.workspace_id == original


def test_thread_routes_validate_schema(client):
    novel = client.post("/api/v1/novels", json={"title": "接口伏笔"}).json()
    entity = client.post(f"/api/v1/novels/{novel['id']}/entities", json={"kind": "thread", "name": "未解释的信"}).json()
    path = f"/api/v1/novels/{novel['id']}/threads"
    assert client.get(path).json()[0]["status"] == "planned"
    assert client.put(path + "/" + entity["id"], json={"base_revision": 0, "intent": "保留悬念"}).status_code == 200
    assert client.put(path + "/" + entity["id"], json={"base_revision": -1}).status_code == 422
