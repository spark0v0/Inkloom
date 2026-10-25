"""Review-driven revision prepares a verified paragraph, never an automatic edit."""
import asyncio

import pytest

from app import schemas as dto
from app.context import validate_result
from app.domain import DomainError, uid
from app.models import Job
from app.providers import StreamPart


def reviewed(library, generation, workspace):
    novel = library.create_novel(dto.NovelInput(title="审稿修订"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="雨夜"))
    version = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
        operation_id=uid("save"), text="序言🙂。\n\n\n重复文字。\n\n重复文字。"))
    chapter = library.chapter(novel.id, chapter.id)
    job = generation.create(novel.id, dto.JobInput(task="review", chapter_id=chapter.id,
        base_version_id=version.id, idempotency_key=uid("review")))
    with workspace.session(write=True) as session:
        row = session.get(Job, job.id)
        sources = row.context["preview"]["sources"]
        raw = {"kind": "review", "summary": "需作者核实", "findings": [{
            "type": "repetition", "severity": "suggestion",
            "target": {"source_id": source["source_id"], "quote": source["text"]},
            "explanation": explanation, "suggestion": suggestion,
        } for source, explanation, suggestion in [(sources[-1], "末段重复", "将末段改成实际行动"),
            (sources[0], "另一条未选择的问题", "UNSELECTED_GUIDANCE")]]}
        row.result = validate_result("review", raw, row.context)
        row.state, row.candidate_status = "succeeded", "ready"
    return novel, chapter, generation.get(novel.id, job.id)


def prepare(generation, novel, chapter, review, index=0):
    return generation.prepare_rewrite(novel.id, review.id,
        dto.ReviewRewriteInput(base_version_id=chapter.working_version_id, index=index))


def writing(chapter, prepared):
    return dto.JobInput(task="rewrite", chapter_id=chapter.id,
        base_version_id=chapter.working_version_id, selection=prepared.selection,
        review_reference=prepared.reference, idempotency_key=uid("rewrite"))


def test_prepare_preserves_text_and_selects_correct_repeated_paragraph(library, generation, workspace):
    novel, chapter, review = reviewed(library, generation, workspace)
    before_jobs = len(generation.list(novel.id))
    prepared = prepare(generation, novel, chapter, review)
    assert prepared.selection.text == "重复文字。"
    assert prepared.selection.start_codepoint == chapter.version.text.rindex("重复文字。")
    assert prepared.selection.end_codepoint == len(chapter.version.text)
    assert prepared.reference.job_id == review.id and prepared.reference.finding_index == 0
    assert len(prepared.reference.finding_hash) == 64
    assert library.chapter(novel.id, chapter.id).version.id == chapter.version.id
    assert len(generation.list(novel.id)) == before_jobs
    assert library.facts(novel.id) == []


def test_only_selected_review_guidance_is_frozen_and_adoption_changes_one_paragraph(library, generation, workspace, monkeypatch):
    novel, chapter, review = reviewed(library, generation, workspace)
    prepared = prepare(generation, novel, chapter, review)
    job = generation.create(novel.id, writing(chapter, prepared))
    with workspace.session() as session:
        frozen = session.get(Job, job.id).context
        assert frozen["input"]["review_guidance"]["finding"]["suggestion"] == "将末段改成实际行动"
        assert "UNSELECTED_GUIDANCE" not in frozen["messages"][1]["content"]
        assert frozen["input"]["canon_facts"] == []
    async def complete(*args):
        yield StreamPart(text="他走向商队问路。")
        yield StreamPart(finish="stop")
    monkeypatch.setattr("app.jobs.stream_completion", complete)
    asyncio.run(generation._execute(*generation.claim()))
    finished = generation.get(novel.id, job.id)
    assert finished.state == "succeeded" and finished.context.review_reference == prepared.reference
    assert library.chapter(novel.id, chapter.id).version.id == chapter.version.id
    adopted = generation.adopt(novel.id, job.id, chapter.version.id)
    assert adopted.text == "序言🙂。\n\n\n重复文字。\n\n他走向商队问路。"
    assert library.version(novel.id, chapter.id, chapter.version.id).text == chapter.version.text


@pytest.mark.parametrize("decision", ["intentional", "false_positive"])
def test_intentional_or_false_positive_finding_cannot_prepare_revision(library, generation, workspace, decision):
    novel, chapter, review = reviewed(library, generation, workspace)
    generation.decide_finding(novel.id, review.id, dto.FindingDecision(index=0, decision=decision))
    with pytest.raises(DomainError) as error:
        prepare(generation, novel, chapter, review)
    assert error.value.code == "REVIEW_DECISION"


@pytest.mark.parametrize("change", ["text", "settings", "references", "decision", "rejected"])
def test_prepared_revision_is_bound_to_current_source(library, generation, workspace, change):
    novel, chapter, review = reviewed(library, generation, workspace)
    prepared = prepare(generation, novel, chapter, review)
    if change == "text":
        library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.version.id,
            operation_id=uid("edit"), text=chapter.version.text + "新变化。"))
    elif change == "settings":
        library.edit_novel(novel.id, dto.NovelPatch(style="第一人称"))
    elif change == "references":
        from app.references import ChapterReferences
        ChapterReferences(workspace).save(novel.id, chapter.id, dto.ReferenceUpdate(base_revision=0,
            selection=dto.ReferenceSelection(notes="新参考")))
    elif change == "decision":
        generation.decide_finding(novel.id, review.id, dto.FindingDecision(index=0, decision="confirmed", note="改为保留悬念"))
    else:
        generation.control(novel.id, review.id, "reject")
    request = writing(chapter, prepared)
    if change == "text":
        request.base_version_id = library.chapter(novel.id, chapter.id).working_version_id
    with pytest.raises(DomainError):
        generation.create(novel.id, request)
    assert len(generation.list(novel.id)) == 1


def test_reference_cannot_change_selection_or_cross_chapter(library, generation, workspace):
    novel, chapter, review = reviewed(library, generation, workspace)
    prepared = prepare(generation, novel, chapter, review)
    request = writing(chapter, prepared)
    request.selection = dto.Selection(start_codepoint=0, end_codepoint=4, text="序言🙂。")
    with pytest.raises(DomainError) as error:
        generation.create(novel.id, request)
    assert error.value.code == "REVIEW_SELECTION_CHANGED"
    other = library.create_chapter(novel.id, dto.ChapterInput(title="异章"))
    request = writing(other, prepared)
    with pytest.raises(DomainError):
        generation.create(novel.id, request)
    foreign = library.create_novel(dto.NovelInput(title="异书"))
    with pytest.raises(DomainError) as error:
        generation.prepare_rewrite(foreign.id, review.id, dto.ReviewRewriteInput(base_version_id=chapter.version.id, index=0))
    assert error.value.status == 404


def test_decision_change_during_generation_prevents_late_adoption(library, generation, workspace, monkeypatch):
    novel, chapter, review = reviewed(library, generation, workspace)
    prepared = prepare(generation, novel, chapter, review)
    job = generation.create(novel.id, writing(chapter, prepared))
    async def changed(*args):
        yield StreamPart(text="尚未采纳的修订。")
        generation.decide_finding(novel.id, review.id, dto.FindingDecision(index=0, decision="false_positive"))
        yield StreamPart(finish="stop")
    monkeypatch.setattr("app.jobs.stream_completion", changed)
    asyncio.run(generation._execute(*generation.claim()))
    assert generation.get(novel.id, job.id).candidate_status == "needs_rebase"
    with pytest.raises(DomainError):
        generation.adopt(novel.id, job.id, chapter.version.id)
    assert library.chapter(novel.id, chapter.id).version.id == chapter.version.id


def test_unselected_decision_does_not_invalidate_selected_revision(library, generation, workspace):
    novel, chapter, review = reviewed(library, generation, workspace)
    prepared = prepare(generation, novel, chapter, review)
    generation.decide_finding(novel.id, review.id, dto.FindingDecision(index=1, decision="false_positive"))
    assert generation.create(novel.id, writing(chapter, prepared)).state == "queued"


def test_prepare_api_rejects_incomplete_review_without_creating_jobs(client):
    novel = client.post("/api/v1/novels", json={"title": "API 修稿"}).json()
    chapter = client.post(f"/api/v1/novels/{novel['id']}/chapters", json={}).json()
    review = client.post(f"/api/v1/novels/{novel['id']}/jobs", json={"task": "review", "chapter_id": chapter["id"],
        "base_version_id": chapter["working_version_id"], "idempotency_key": uid("review")}).json()
    response = client.post(f"/api/v1/jobs/{review['id']}/prepare-rewrite?novel_id={novel['id']}",
        json={"index": 0, "base_version_id": chapter["working_version_id"]})
    assert response.status_code == 409
    assert len(client.get("/api/v1/jobs").json()) == 1


def test_author_notes_remain_pending_and_cannot_overwrite_other_window(library, generation, workspace):
    novel, chapter, review = reviewed(library, generation, workspace)
    generation.decide_finding(novel.id, review.id, dto.FindingDecision(index=0, decision="pending", note="保留视角",
        base_decision="pending", base_note=""))
    with pytest.raises(DomainError) as error:
        generation.decide_finding(novel.id, review.id, dto.FindingDecision(index=0, decision="intentional", note="旧窗口说明",
            base_decision="pending", base_note=""))
    assert error.value.code == "REVIEW_DECISION_CONFLICT"
    prepared = prepare(generation, novel, chapter, review)
    assert prepared.finding.decision == "pending" and prepared.finding.decision_note == "保留视角"


def test_changed_selected_decision_invalidates_ready_revision(library, generation, workspace):
    novel, chapter, review = reviewed(library, generation, workspace)
    prepared = prepare(generation, novel, chapter, review)
    job = generation.create(novel.id, writing(chapter, prepared))
    with workspace.session(write=True) as session:
        row = session.get(Job, job.id)
        row.state, row.candidate_status, row.output_text = "succeeded", "ready", "修订候选。"
    generation.decide_finding(novel.id, review.id, dto.FindingDecision(index=0, decision="intentional"))
    assert generation.get(novel.id, job.id).candidate_status == "needs_rebase"


def test_adoption_rechecks_persisted_selection_against_review_target(library, generation, workspace):
    novel, chapter, review = reviewed(library, generation, workspace)
    prepared = prepare(generation, novel, chapter, review)
    job = generation.create(novel.id, writing(chapter, prepared))
    with workspace.session(write=True) as session:
        row = session.get(Job, job.id)
        row.state, row.candidate_status, row.output_text = "succeeded", "ready", "只能替换末段。"
        # Even a structurally valid restored/tampered selection cannot change the target.
        row.selection = dto.Selection(start_codepoint=0, end_codepoint=4, text="序言🙂。").model_dump()
    with pytest.raises(DomainError) as error:
        generation.adopt(novel.id, job.id, chapter.version.id)
    assert error.value.code == "CONTEXT_STALE"
    assert library.chapter(novel.id, chapter.id).version.id == chapter.version.id
