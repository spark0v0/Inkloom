import asyncio
import io
import json
import zipfile

import pytest

from app import schemas as dto
from app.domain import DomainError, char_count, resolve_evidence, uid
from app.library import Library
from app.storage import Workspace
from app.workspace_io import activate_original, activate_restore, backup, restore


def chapter_with_text(library, title="测试作品", body="林舟来到了雾港。\n\n他收起航海图。"):
    novel = library.create_novel(dto.NovelInput(title=title))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="第一章"))
    version = library.save(novel.id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id, operation_id=uid("save"), text=body))
    return novel, library.chapter(novel.id, chapter.id), version


def execute(generation):
    claimed = generation.claim()
    assert claimed is not None
    asyncio.run(generation._execute(*claimed))


def test_version_conflict_and_idempotency(library):
    novel, chapter, version = chapter_with_text(library)
    request = dto.SaveInput(base_version_id=version.id, operation_id=uid("save"), text="新稿😀。")
    first = library.save(novel.id, chapter.id, request)
    assert library.save(novel.id, chapter.id, request).id == first.id
    with pytest.raises(DomainError, match="新版本") as error:
        library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=version.id,
            operation_id=uid("save"), text="另一份未丢弃的稿件"))
    assert error.value.code == "VERSION_CONFLICT"
    with pytest.raises(DomainError) as error:
        library.save(novel.id, chapter.id, request.model_copy(update={"text": "不同内容"}))
    assert error.value.code == "IDEMPOTENCY_CONFLICT"
    assert library.version(novel.id, chapter.id, version.id).text == version.text
    assert first.char_count == char_count("新稿😀。")


def test_close_releases_windows_file_handles(tmp_path):
    root = tmp_path / "lifecycle"
    ws = Workspace(root)
    Library(ws).create_novel(dto.NovelInput(title="句柄回归"))
    ws.close()
    assert ws.db.path.resolve().is_relative_to(root.resolve())
    ws.db.path.unlink()


def test_evidence_codepoints_and_book_isolation(library):
    novel, chapter, version = chapter_with_text(library, body="😀林舟说：你好。")
    paragraph = version.paragraphs[0]
    source = {"source_id": "example", "text": paragraph.text, "version_id": version.id}
    evidence = resolve_evidence({"source_id": "example", "quote": "林舟"}, [source])
    assert (evidence["start_codepoint"], evidence["end_codepoint"]) == (1, 3)
    other = library.create_novel(dto.NovelInput(title="另一本"))
    with pytest.raises(DomainError) as error:
        library.chapter(other.id, chapter.id)
    assert error.value.status == 404
    with pytest.raises(DomainError):
        resolve_evidence({"source_id": "unknown", "quote": "林舟"}, [source])
    with pytest.raises(DomainError):
        resolve_evidence({"source_id": "example", "quote": "不存在"}, [source])


def test_confirmation_short_chinese_search_and_invalidation(library):
    novel, chapter, version = chapter_with_text(library)
    p = version.paragraphs[0]
    change = dto.MemoryProposal(claim="林舟来到了雾港。", subject="林舟",
        evidence=[dto.Evidence(source_id=f"{version.id}:{p.paragraph_id}", quote=p.text)])
    confirmation = dto.CanonInput(version_id=version.id, operation_id=uid("canon"), changes=[change])
    first = library.confirm(novel.id, chapter.id, confirmation)
    assert library.confirm(novel.id, chapter.id, confirmation).revision == first.revision
    assert library.search(novel.id, "林舟")[0].source.version_id == version.id
    second_novel, _, _ = chapter_with_text(library, title="同名人物", body="林舟去了不同的城市。")
    assert library.search(second_novel.id, "林舟") == []
    library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=version.id,
        operation_id=uid("revision"), text="林舟没有去过雾港。"))
    assert library.novel(novel.id).dirty_from_order == 1
    assert library.search(novel.id, "林舟") == []
    assert library.facts(novel.id) == []
    assert len(library.facts(novel.id, True)) == 1


def test_demo_generation_adoption_and_duplicate(library, generation):
    novel, chapter, version = chapter_with_text(library)
    request = dto.JobInput(chapter_id=chapter.id, base_version_id=version.id,
        task="continue", instruction="接着写", idempotency_key=uid("job"))
    job = generation.create(novel.id, request)
    assert generation.create(novel.id, request).id == job.id
    assert job.is_demo
    execute(generation)
    result = generation.get(novel.id, job.id)
    assert result.state == "succeeded"
    assert result.cost == 0
    assert result.attempts[0].usage is None
    assert library.chapter(novel.id, chapter.id).working_version_id == version.id
    adopted = generation.adopt(novel.id, job.id, version.id)
    assert adopted.text.startswith(version.text)
    assert generation.adopt(novel.id, job.id, version.id).id == adopted.id
    assert library.version(novel.id, chapter.id, version.id).text == version.text


def test_edit_while_generating_prevents_silent_adoption(library, generation):
    novel, chapter, version = chapter_with_text(library)
    job = generation.create(novel.id, dto.JobInput(chapter_id=chapter.id,
        base_version_id=version.id, task="continue", idempotency_key=uid("job")))
    execute(generation)
    updated = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=version.id,
        operation_id=uid("save"), text="作者自己的新文字"))
    with pytest.raises(DomainError) as error:
        generation.adopt(novel.id, job.id, version.id)
    assert error.value.code == "VERSION_CONFLICT"
    assert library.chapter(novel.id, chapter.id).working_version_id == updated.id


def test_cancel_fences_a_late_result(library, generation):
    novel, chapter, version = chapter_with_text(library)
    job = generation.create(novel.id, dto.JobInput(chapter_id=chapter.id,
        base_version_id=version.id, task="continue", idempotency_key=uid("job")))
    claimed = generation.claim()
    generation.control(novel.id, job.id, "cancel")
    asyncio.run(generation._execute(*claimed))
    result = generation.get(novel.id, job.id)
    assert result.state == "cancelled"
    assert result.candidate_status == "partial"
    with pytest.raises(DomainError):
        generation.adopt(novel.id, job.id, version.id)


def test_extract_only_proposes_and_confirm_validates_source(library, generation):
    novel, chapter, version = chapter_with_text(library)
    job = generation.create(novel.id, dto.JobInput(chapter_id=chapter.id,
        base_version_id=version.id, task="extract", idempotency_key=uid("job")))
    execute(generation)
    result = generation.get(novel.id, job.id)
    assert result.result.kind == "extract"
    assert library.facts(novel.id) == []
    library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id,
        operation_id=uid("canon"), changes=result.result.changes))
    assert library.facts(novel.id)


def test_backup_restore_preserves_versions_and_excludes_keys(library, generation, workspace):
    novel, chapter, version = chapter_with_text(library)
    secret = "fake-canary-never-export-this"
    workspace.db.secrets.set("test-key", secret)
    archive = backup(workspace)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        assert set(zipped.namelist()) == {"manifest.json", "workspace.db"}
        assert secret.encode() not in zipped.read("workspace.db")
        assert json.loads(zipped.read("manifest.json"))["credentials_included"] is False
    original_id = workspace.db.workspace_id
    restored = restore(workspace, archive)
    activate_restore(workspace, restored["restore_id"])
    assert workspace.db.workspace_id != original_id
    assert library.chapter(novel.id, chapter.id).version.text == version.text
    assert workspace.db.secrets.get("test-key") == ""
    activate_original(workspace)
    assert workspace.db.workspace_id == original_id
    assert workspace.db.secrets.get("test-key") == secret


def test_invalid_archive_cannot_change_workspace(workspace):
    original = workspace.db.workspace_id
    with pytest.raises(DomainError):
        restore(workspace, b"not a zip")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("../../escape.db", b"evil")
    with pytest.raises(DomainError):
        restore(workspace, buffer.getvalue())
    assert workspace.db.workspace_id == original


def test_alias_search_and_long_range_context_remain_book_scoped(library, generation):
    novel, first, version = chapter_with_text(library, body="沈砚把北岸钥匙交给林舟。")
    library.put_entity(novel.id, dto.EntityInput(kind="character", name="沈砚", aliases=["沈先生"]))
    library.confirm(novel.id, first.id, dto.CanonInput(version_id=version.id, operation_id=uid("canon")))
    for index in range(2, 5):
        chapter = library.create_chapter(novel.id, dto.ChapterInput(title=f"第{index}章"))
        saved = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.version.id,
            operation_id=uid("save"), text="旧钟楼里的灯依然亮着。"))
        library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=saved.id, operation_id=uid("canon")))
    current = library.create_chapter(novel.id, dto.ChapterInput(title="第五章"))
    preview = generation.preview(novel.id, dto.ContextInput(chapter_id=current.id,
        base_version_id=current.version.id, task="continue", instruction="让沈先生带着北岸钥匙出现"))
    assert any(source.version_id == version.id for source in preview.sources)
    assert library.search(novel.id, "沈先生")[0].source.version_id == version.id
    other = library.create_novel(dto.NovelInput(title="另一本书"))
    assert library.search(other.id, "沈先生") == []


def test_excluded_source_also_removes_dependent_fact(library, generation):
    novel, first, version = chapter_with_text(library)
    source_id = f"{version.id}:{version.paragraphs[0].paragraph_id}"
    library.confirm(novel.id, first.id, dto.CanonInput(version_id=version.id, operation_id=uid("canon"),
        changes=[dto.MemoryProposal(claim="林舟抵达雾港", evidence=[dto.Evidence(source_id=source_id, quote="林舟来到了雾港。")])]))
    second = library.create_chapter(novel.id, dto.ChapterInput(title="第二章"))
    context = generation.preview(novel.id, dto.ContextInput(chapter_id=second.id,
        base_version_id=second.version.id, task="continue", excluded_source_ids=[source_id]))
    assert not context.facts
    assert all(source.source_id != source_id for source in context.sources)


def test_ten_chapter_demo_loop_then_rebuild_dirty_suffix(library, generation):
    novel = library.create_novel(dto.NovelInput(title="十章流程样例"))
    chapters = []
    for index in range(1, 11):
        chapter = library.create_chapter(novel.id, dto.ChapterInput(title=f"第{index}章"))
        version = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.version.id,
            operation_id=uid("save"), text=f"第{index}日，林舟检查了潮汐记录。"))
        job = generation.create(novel.id, dto.JobInput(chapter_id=chapter.id, base_version_id=version.id,
            task="continue", idempotency_key=uid("job")))
        execute(generation)
        adopted = generation.adopt(novel.id, job.id, version.id)
        extract = generation.create(novel.id, dto.JobInput(chapter_id=chapter.id, base_version_id=adopted.id,
            task="extract", idempotency_key=uid("job")))
        execute(generation)
        proposed = generation.get(novel.id, extract.id).result.changes
        library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=adopted.id,
            operation_id=uid("canon"), changes=proposed))
        chapters.append(library.chapter(novel.id, chapter.id))
    assert library.novel(novel.id).accepted_count == 10
    third = chapters[2]
    library.save(novel.id, third.id, dto.SaveInput(base_version_id=third.version.id,
        operation_id=uid("save"), text="第3日的潮汐记录被作者重新核对。"))
    assert library.novel(novel.id).dirty_from_order == 3
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, dto.ContextInput(chapter_id=chapters[9].id,
            base_version_id=chapters[9].version.id, task="continue"))
    assert error.value.code == "CANON_DIRTY"
    for chapter in chapters[2:]:
        current = library.chapter(novel.id, chapter.id)
        library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=current.version.id,
            operation_id=uid("canon")))
    assert library.novel(novel.id).dirty_from_order is None
    assert library.novel(novel.id).accepted_count == 10
    assert library.version(novel.id, third.id, third.version.id).text == third.version.text
