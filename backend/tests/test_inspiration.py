"""In-chapter ideation is a suggestion, never manuscript or canon mutation."""
import asyncio
import json

import pytest
from pydantic import ValidationError
from sqlalchemy import event

from app import schemas as dto
from app.context import validate_result
from app.domain import DomainError, uid
from app.models import Job
from app.providers import StreamPart, demo_text


@pytest.fixture(autouse=True)
def instant_demo(monkeypatch):
    async def complete(config, key, messages, task, context):
        yield StreamPart(text=demo_text(task, context))
        yield StreamPart(finish="stop")
    monkeypatch.setattr("app.jobs.stream_completion", complete)


def setup(library):
    novel = library.create_novel(dto.NovelInput(title="剧情方向测试"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="账本"))
    version = library.save(novel.id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id, operation_id=uid("save"),
        text="陈序拿到了账本，却发现书页中夹着一封未署名的信。"))
    return novel, library.chapter(novel.id, chapter.id), version


def execute(generation, job):
    claimed = generation.claim()
    assert claimed is not None
    asyncio.run(generation._execute(*claimed))
    return generation.get(job.novel_id, job.id)


def ideas(generation, novel, chapter):
    return generation.create(novel.id, dto.JobInput(task="inspiration", chapter_id=chapter.id,
        base_version_id=chapter.working_version_id, instruction="人物没有理由行动",
        idempotency_key=uid("ideas")))


def follow(chapter, job, index=1, **kwargs):
    return dto.ContextInput(task="continue", chapter_id=chapter.id,
        base_version_id=chapter.working_version_id,
        inspiration=dto.InspirationReference(job_id=job.id, option_index=index), **kwargs)


def test_ideas_are_durable_and_only_chosen_direction_enters_writing(library, generation, workspace):
    novel, chapter, version = setup(library)
    finished = execute(generation, ideas(generation, novel, chapter))
    assert finished.state == "succeeded", finished.error_message
    assert finished.result.kind == "inspiration"
    assert len(finished.result.options) == 3
    assert all(option.evidence[0].version_id == version.id for option in finished.result.options)
    assert library.chapter(novel.id, chapter.id).version.id == version.id
    assert library.plans(novel.id) == library.facts(novel.id) == library.entities(novel.id) == []
    assert generation.list(novel.id, chapter.id, "inspiration")[0].id == finished.id
    request = follow(chapter, finished)
    preview = generation.preview(novel.id, request)
    assert preview.inspiration_title == finished.result.options[1].title
    assert preview.inspiration_reference.job_id == finished.id
    assert preview.inspiration_reference.option_index == 1
    writing = generation.create(novel.id, dto.JobInput(**request.model_dump(), idempotency_key=uid("write")))
    with workspace.session() as session:
        frozen = session.get(Job, writing.id).context
        assert frozen["input"]["inspiration_direction"]["direction"]["title"] == finished.result.options[1].title
        assert finished.result.options[0].title not in frozen["messages"][1]["content"]
        assert finished.result.options[2].title not in frozen["messages"][1]["content"]
        assert frozen["input"]["canon_facts"] == []
    result = execute(generation, writing)
    assert library.chapter(novel.id, chapter.id).version.id == version.id
    adopted = generation.adopt(novel.id, result.id, version.id)
    assert adopted.text.startswith(version.text + "\n\n")
    assert library.facts(novel.id) == []


@pytest.mark.parametrize("change", ["manuscript", "settings", "goal"])
def test_old_direction_cannot_be_applied_after_baseline_changes(library, generation, change):
    novel, chapter, _ = setup(library)
    job = execute(generation, ideas(generation, novel, chapter))
    if change == "manuscript":
        library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
            operation_id=uid("edit"), text="人物已经烧掉了账本。"))
    elif change == "settings":
        library.edit_novel(novel.id, dto.NovelPatch(style="第一人称"))
    else:
        library.edit_chapter(novel.id, chapter.id, dto.ChapterPatch(goal="停止调查"))
    current = library.chapter(novel.id, chapter.id)
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, follow(current, job))
    assert error.value.code == "INSPIRATION_STALE"


def test_direction_cannot_cross_novel_or_chapter(library, generation):
    novel, chapter, _ = setup(library)
    job = execute(generation, ideas(generation, novel, chapter))
    other_novel, other_chapter, _ = setup(library)
    with pytest.raises(DomainError) as error:
        generation.preview(other_novel.id, follow(other_chapter, job))
    assert error.value.code == "JOB_NOT_FOUND"
    second = library.create_chapter(novel.id, dto.ChapterInput())
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, follow(second, job))
    assert error.value.code == "INSPIRATION_NOT_READY"


def test_incomplete_and_cancelled_directions_cannot_be_used(library, generation):
    novel, chapter, _ = setup(library)
    job = ideas(generation, novel, chapter)
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, follow(chapter, job))
    assert error.value.code == "INSPIRATION_NOT_READY"
    generation.control(novel.id, job.id, "cancel")
    with pytest.raises(DomainError):
        generation.preview(novel.id, follow(chapter, job))
    assert library.chapter(novel.id, chapter.id).version.text == chapter.version.text


def test_ideas_cannot_be_adopted_as_prose_or_used_as_memory(library, generation):
    novel, chapter, _ = setup(library)
    job = execute(generation, ideas(generation, novel, chapter))
    with pytest.raises(DomainError) as error:
        generation.adopt(novel.id, job.id, chapter.working_version_id)
    assert error.value.code == "CANDIDATE_NOT_READY"
    request = follow(chapter, job).model_copy(update={"task": "extract"})
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, request)
    assert error.value.code == "INVALID_INSPIRATION_TASK"


@pytest.mark.parametrize("fault", ["foreign_source", "false_quote", "two_options", "duplicate_titles"])
def test_invalid_model_ideas_are_rejected(library, generation, workspace, fault):
    novel, chapter, _ = setup(library)
    job = ideas(generation, novel, chapter)
    with workspace.session() as session:
        context = session.get(Job, job.id).context
    raw = json.loads(demo_text("inspiration", context))
    if fault == "foreign_source":
        raw["options"][0]["evidence"][0]["source_id"] = "other-novel:paragraph"
    elif fault == "false_quote":
        raw["options"][0]["evidence"][0]["quote"] = "原文中没有出现的事实。"
    elif fault == "two_options":
        raw["options"].pop()
    else:
        raw["options"][1]["title"] = raw["options"][0]["title"]
    with pytest.raises((DomainError, ValidationError)):
        validate_result("inspiration", raw, context)


def test_chapter_scoped_recovery_filters_before_limit_and_skips_context(library, generation, workspace):
    novel, chapter, _ = setup(library)
    wanted = execute(generation, ideas(generation, novel, chapter))
    second = library.create_chapter(novel.id, dto.ChapterInput())
    with workspace.session(write=True) as session:
        source = session.get(Job, wanted.id)
        values = {column.name: getattr(source, column.name) for column in Job.__table__.columns}
        for _ in range(155):
            session.add(Job(**{**values, "id": uid("later"), "chapter_id": second.id,
                "idempotency_key": uid("copy"), "created_at": "2099-01-01T00:00:00Z"}))
    statements = []
    def record(connection, cursor, statement, params, context, many):
        statements.append(statement)
    event.listen(workspace.db.engine, "before_cursor_execute", record)
    try:
        result = generation.list(novel.id, chapter.id, "inspiration")
    finally:
        event.remove(workspace.db.engine, "before_cursor_execute", record)
    assert [job.id for job in result] == [wanted.id]
    assert not any("jobs.context" in statement for statement in statements)


def test_job_filter_requires_matching_novel(client):
    response = client.get("/api/v1/jobs?chapter_id=unknown")
    assert response.status_code == 400
    assert response.json()["code"] == "NOVEL_REQUIRED"
    assert client.get("/api/v1/jobs?task=not-a-task").status_code == 422


def test_empty_draft_can_get_ideas_without_fabricated_evidence(library, generation):
    novel = library.create_novel(dto.NovelInput(title="空白卡点"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput())
    result = execute(generation, ideas(generation, novel, chapter))
    assert result.state == "succeeded"
    assert all(option.evidence == [] for option in result.result.options)
    assert library.chapter(novel.id, chapter.id).version.text == ""


def test_invalid_structured_response_stays_failed_and_preserves_original(library, generation, monkeypatch):
    novel, chapter, _ = setup(library)
    async def incomplete(config, key, messages, task, context):
        yield StreamPart(text='{"kind":"inspiration","diagnosis":"残缺结果"}')
        yield StreamPart(finish="stop")
    monkeypatch.setattr("app.jobs.stream_completion", incomplete)
    result = execute(generation, ideas(generation, novel, chapter))
    assert result.state == "failed"
    assert result.error_code == "INVALID_STRUCTURED_OUTPUT"
    assert result.result is None
    assert "残缺结果" in result.output_text
    assert result.candidate_status == "partial"
    assert library.chapter(novel.id, chapter.id).version.text == chapter.version.text
