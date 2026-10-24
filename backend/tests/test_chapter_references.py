"""Author-selected context is mandatory, versioned, scoped and never canon."""
import asyncio
import json

import pytest

from app import schemas as dto
from app.domain import DomainError, uid
from app.models import Job, Provider
from app.providers import StreamPart, demo_text
from app.workspace_io import activate_restore, backup, restore


def confirmed(library, novel_id, title, text):
    chapter = library.create_chapter(novel_id, dto.ChapterInput(title=title))
    version = library.save(novel_id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id, operation_id=uid("save"), text=text))
    library.confirm(novel_id, chapter.id, dto.CanonInput(version_id=version.id, operation_id=uid("confirm")))
    return chapter, version


def setup(library):
    novel = library.create_novel(dto.NovelInput(title="参考选择测试"))
    old, version = confirmed(library, novel.id, "初遇", "罗盘已经损坏，不能再用来辨认方向。")
    confirmed(library, novel.id, "途中", "他们跟着商队前行。")
    confirmed(library, novel.id, "夜宿", "众人在驿站过夜。")
    current = library.create_chapter(novel.id, dto.ChapterInput(title="继续出发"))
    return novel, old, version, current


def references(library):
    from app.references import ChapterReferences
    return ChapterReferences(library.ws)


def selection(entity_ids=None, chapter=None, version=None, notes=""):
    return dto.ReferenceSelection(entity_ids=entity_ids or [], notes=notes,
        chapters=[dto.ChapterReferenceVersion(chapter_id=chapter.id, version_id=version.id)] if chapter else [])


def request(chapter, task="continue", **kwargs):
    return dto.ContextInput(chapter_id=chapter.id, base_version_id=chapter.working_version_id, task=task, **kwargs)


def test_preview_reports_the_requested_target_instead_of_book_default(library, generation):
    novel = library.create_novel(dto.NovelInput(title="字数", chapter_words=3000))
    chapter = library.create_chapter(novel.id, dto.ChapterInput())
    preview = generation.preview(novel.id, request(chapter, target_chars=500))
    assert preview.target_chars == 500


def test_references_endpoint_is_a_scoped_author_operation(client):
    novel = client.post("/api/v1/novels", json={"title": "参考接口"}).json()
    chapter = client.post(f"/api/v1/novels/{novel['id']}/chapters", json={}).json()
    path = f"/api/v1/novels/{novel['id']}/chapters/{chapter['id']}/references"
    response = client.get(path)
    assert response.status_code == 200
    assert response.json()["revision"] == 0
    changed = client.put(path, json={"base_revision": 0, "selection": {"notes": "潮汐资料，仅用于创作参考。"}})
    assert changed.status_code == 200
    assert changed.json()["revision"] == 1
    assert client.get(f"/api/v1/novels/{novel['id']}/chapters/{chapter['id']}").json()["version"] == chapter["version"]


def test_pins_survive_limits_and_are_frozen_without_changing_prose(library, generation, workspace):
    novel, old, version, current = setup(library)
    person = library.put_entity(novel.id, dto.EntityInput(kind="character", name="旧相识", body="只会说方言。"))
    for i in range(65):
        library.put_entity(novel.id, dto.EntityInput(kind="character", name=f"配角{i}"))
    service = references(library)
    chosen = selection([person.id], old, version, notes="火车时刻样例；不是小说中已经发生的事。")
    saved = service.save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=chosen))
    assert saved.revision == 1
    assert library.chapter(novel.id, current.id).references == chosen
    job = generation.create(novel.id, dto.JobInput(**request(current).model_dump(), idempotency_key=uid("job")))
    assert job.context.pinned_entity_ids == [person.id]
    assert any(s.version_id == version.id and s.pinned for s in job.context.sources)
    assert person.id in {e.id for e in job.context.entities}
    with workspace.session() as session:
        body = session.get(Job, job.id).context["input"]
        assert body["reference_material"]["status"] == "author_supplied_noncanonical"
        assert body["reference_material"]["text"] == chosen.notes
        assert chosen.notes not in json.dumps(body["canon_facts"], ensure_ascii=False)
    assert library.chapter(novel.id, current.id).version.text == ""
    assert library.facts(novel.id) == []


def test_references_have_independent_revisions_and_idempotent_save(library, generation):
    novel, _, _, current = setup(library)
    service = references(library)
    update = dto.ReferenceUpdate(base_revision=0, selection=selection(notes="先写人物选择"))
    first = service.save(novel.id, current.id, update)
    assert service.save(novel.id, current.id, update) == first
    with pytest.raises(DomainError) as error:
        service.save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=selection(notes="另一窗口的修改")))
    assert error.value.code == "REFERENCE_CONFLICT"
    assert service.get(novel.id, current.id) == first
    assert library.novel(novel.id).settings_revision == novel.settings_revision


def test_generation_rejects_an_outdated_reference_revision(library, generation):
    novel, _, _, current = setup(library)
    pending = request(current, references_revision=0)
    references(library).save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=selection(notes="新参考")))
    with pytest.raises(DomainError) as error:
        generation.create(novel.id, dto.JobInput(**pending.model_dump(), idempotency_key=uid("job")))
    assert error.value.code == "REFERENCE_CONFLICT"
    assert generation.list(novel.id) == []


@pytest.mark.parametrize("invalid", ["foreign_entity", "foreign_chapter", "future", "draft", "wrong_version", "proposed"])
def test_invalid_pins_are_rejected_before_they_can_be_used(library, generation, invalid):
    novel, old, version, current = setup(library)
    other = library.create_novel(dto.NovelInput(title="另一作品"))
    foreign, foreign_version = confirmed(library, other.id, "异书", "异书秘密。")
    if invalid == "foreign_entity":
        entity = library.put_entity(other.id, dto.EntityInput(kind="character", name="异书人物"))
        chosen = selection([entity.id])
    elif invalid == "proposed":
        entity = library.put_entity(novel.id, dto.EntityInput(kind="character", name="未确认人物", status="proposed"))
        chosen = selection([entity.id])
    elif invalid == "foreign_chapter":
        chosen = selection(chapter=foreign, version=foreign_version)
    elif invalid == "future":
        written = library.save(novel.id, current.id, dto.SaveInput(base_version_id=current.working_version_id,
            operation_id=uid("current"), text="还没有遇见未来人物。"))
        library.confirm(novel.id, current.id, dto.CanonInput(version_id=written.id, operation_id=uid("confirm")))
        future, future_version = confirmed(library, novel.id, "未来章", "未来秘密。")
        chosen = selection(chapter=future, version=future_version)
    elif invalid == "draft":
        library.save(novel.id, old.id, dto.SaveInput(base_version_id=version.id, operation_id=uid("change"), text="罗盘修好了。"))
        chosen = selection(chapter=old, version=version)
    else:
        chosen = selection(chapter=old, version=foreign_version)
    with pytest.raises(DomainError):
        references(library).save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=chosen))
    assert references(library).get(novel.id, current.id).revision == 0


def test_changed_prior_text_requires_explicit_reconfirmation(library, generation):
    novel, old, version, current = setup(library)
    service = references(library)
    service.save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=selection(chapter=old, version=version)))
    changed = library.save(novel.id, old.id, dto.SaveInput(base_version_id=version.id, operation_id=uid("change"), text="罗盘丢失了。"))
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, request(current, "review"))
    assert error.value.code == "REFERENCE_STALE"
    assert service.get(novel.id, current.id).selection.chapters[0].version_id == version.id
    library.confirm(novel.id, old.id, dto.CanonInput(version_id=changed.id, operation_id=uid("confirm")))
    with pytest.raises(DomainError):
        generation.preview(novel.id, request(current, "review"))
    service.save(novel.id, current.id, dto.ReferenceUpdate(base_revision=1, selection=selection(chapter=old, version=changed)))
    preview = generation.preview(novel.id, request(current, "review"))
    assert any(s.version_id == changed.id and s.pinned for s in preview.sources)


def test_pinned_sources_cannot_be_excluded_and_budget_does_not_trim_them(library, generation, workspace):
    novel, old, version, current = setup(library)
    service = references(library)
    service.save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=selection(chapter=old, version=version)))
    source_id = f"{version.id}:{version.paragraphs[0].paragraph_id}"
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, request(current, excluded_source_ids=[source_id]))
    assert error.value.code == "PROTECTED_CONTEXT"
    service.save(novel.id, current.id, dto.ReferenceUpdate(base_revision=1, selection=selection(notes="必须保留的补充资料。" * 900)))
    with workspace.session(write=True) as session:
        session.get(Provider, "demo").context_window = 8000
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, request(current))
    assert error.value.code == "CONTEXT_TOO_LARGE"
    assert generation.list(novel.id) == []


def test_reference_change_invalidates_current_candidate_but_not_other_chapters(library, generation, monkeypatch):
    async def instant(config, key, messages, task, context):
        yield StreamPart(text=demo_text(task, context))
        yield StreamPart(finish="stop")
    monkeypatch.setattr("app.jobs.stream_completion", instant)
    novel, old, _, current = setup(library)
    job = generation.create(novel.id, dto.JobInput(**request(current).model_dump(), idempotency_key=uid("job")))
    asyncio.run(generation._execute(*generation.claim()))
    assert generation.get(novel.id, job.id).candidate_status == "ready"
    prior = library.chapter(novel.id, old.id)
    other_job = generation.create(novel.id, dto.JobInput(**request(prior, "review").model_dump(), idempotency_key=uid("review")))
    asyncio.run(generation._execute(*generation.claim()))
    references(library).save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=selection(notes="改用另一场景")))
    assert generation.get(novel.id, job.id).candidate_status == "needs_rebase"
    assert generation.get(novel.id, other_job.id).candidate_status == "ready"
    with pytest.raises(DomainError):
        generation.adopt(novel.id, job.id, current.working_version_id)


def test_legacy_job_detail_recovers_target_from_frozen_input(library, generation, workspace):
    novel = library.create_novel(dto.NovelInput(title="旧任务", chapter_words=3000))
    chapter = library.create_chapter(novel.id, dto.ChapterInput())
    job = generation.create(novel.id, dto.JobInput(**request(chapter, target_chars=500).model_dump(), idempotency_key=uid("job")))
    with workspace.session(write=True) as session:
        stored = session.get(Job, job.id)
        context = json.loads(json.dumps(stored.context))
        context["preview"].pop("target_chars", None)
        stored.context = context
    assert generation.get(novel.id, job.id).context.target_chars == 500


def test_late_generation_is_stale_when_references_change_during_the_call(library, generation, monkeypatch):
    novel, _, _, current = setup(library)
    async def changed_during_call(config, key, messages, task, context):
        references(library).save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=selection(notes="另一方向")))
        yield StreamPart(text=demo_text(task, context))
        yield StreamPart(finish="stop")
    monkeypatch.setattr("app.jobs.stream_completion", changed_during_call)
    job = generation.create(novel.id, dto.JobInput(**request(current).model_dump(), idempotency_key=uid("job")))
    asyncio.run(generation._execute(*generation.claim()))
    finished = generation.get(novel.id, job.id)
    assert finished.state == "succeeded"
    assert finished.candidate_status == "needs_rebase"
    assert library.chapter(novel.id, current.id).version.text == ""


def test_backup_preserves_reference_versions_and_notes(library, generation, workspace):
    novel, old, version, current = setup(library)
    service = references(library)
    chosen = selection(chapter=old, version=version, notes="自写研究笔记。")
    service.save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=chosen))
    recovered = restore(workspace, backup(workspace))
    activate_restore(workspace, recovered["restore_id"])
    state = service.get(novel.id, current.id)
    assert state.revision == 1 and state.selection == chosen
    assert any(source.version_id == version.id and source.pinned for source in generation.preview(novel.id, request(current)).sources)


def test_restore_rejects_reference_to_another_book_without_switching_workspace(library, generation, workspace, tmp_path):
    import hashlib
    import io
    import sqlite3
    import zipfile
    novel, old, version, current = setup(library)
    other = library.create_novel(dto.NovelInput(title="异书"))
    foreign, foreign_version = confirmed(library, other.id, "秘密", "只属于另一部作品。")
    with zipfile.ZipFile(io.BytesIO(backup(workspace))) as archive:
        manifest, raw = json.loads(archive.read("manifest.json")), archive.read("workspace.db")
    database = tmp_path / "tampered-references.db"
    database.write_bytes(raw)
    with sqlite3.connect(database) as connection:
        connection.execute('UPDATE chapters SET "references"=? WHERE id=?', (
            selection(chapter=foreign, version=foreign_version).model_dump_json(), current.id))
        connection.commit()
        modified = connection.serialize()
    manifest["files"]["workspace.db"] = {"bytes": len(modified), "sha256": hashlib.sha256(modified).hexdigest()}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("workspace.db", modified)
    original = workspace.db.workspace_id
    with pytest.raises(DomainError) as error:
        restore(workspace, buffer.getvalue())
    assert error.value.code == "INVALID_DATABASE"
    assert workspace.db.workspace_id == original
    assert library.chapter(novel.id, current.id).version.text == ""
