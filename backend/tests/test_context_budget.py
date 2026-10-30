import json

import pytest

from app import schemas as dto
from app.context import build_context
from app.domain import DomainError, source_for, uid
from app.models import Provider
from app.references import ChapterReferences


def confirmed(library, novel_id, title, body, changes=None):
    chapter = library.create_chapter(novel_id, dto.ChapterInput(title=title))
    version = library.save(novel_id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id, operation_id=uid("save"), text=body))
    proposals = changes(version, chapter) if changes else []
    library.confirm(novel_id, chapter.id, dto.CanonInput(
        version_id=version.id, operation_id=uid("confirm"), changes=proposals))
    return chapter, version


def small_window(library):
    with library.ws.session(write=True) as session:
        provider = session.get(Provider, "demo")
        provider.context_window, provider.max_output_tokens = 16000, 2000


def prepare(library, novel, chapter, **options):
    with library.ws.session() as session:
        context = build_context(session, novel.id, dto.ContextInput(chapter_id=chapter.id,
            base_version_id=chapter.working_version_id, task="continue", **options))
    preview = dto.ContextOut(**context["preview"])
    sent = json.loads(context["messages"][1]["content"])
    assert preview.estimated_input_tokens <= 16000 - 2000 - 1280
    assert [s.model_dump() for s in preview.sources if s.kind != "draft"] == [
        dto.Source.model_validate(source).model_dump() for source in sent["sources"]]
    assert [f.model_dump() for f in preview.facts] == sent["canon_facts"]
    return preview, sent


def long_prose(prefix):
    return "\n\n".join(f"{prefix}第{i}处。" + "街坊陆续走过码头，商贩收起篷布，车队向城里缓缓前行。" * 6
        for i in range(32))


def test_automatic_recent_prose_yields_budget_but_keeps_latest_ending_and_rare_clue(library, generation):
    novel = library.create_novel(dto.NovelInput(title="持续写作预算"))
    _, old = confirmed(library, novel.id, "旧约", "玄令已经用尽，再也不能启动。")
    confirmed(library, novel.id, "途中", long_prose("早晨"))
    _, latest = confirmed(library, novel.id, "夜宿", long_prose("黄昏") + "\n\n守卫递来一封密信。")
    current = library.create_chapter(novel.id, dto.ChapterInput(title="第四章", goal="玄令的限制"))
    small_window(library)

    preview, _ = prepare(library, novel, current)

    source_ids = {s.source_id for s in preview.sources}
    assert all(f"{latest.id}:{p.paragraph_id}" in source_ids for p in latest.paragraphs[-2:])
    assert any(s.version_id == old.id for s in preview.sources)
    assert any("预算" in notice and "原文" in notice for notice in preview.notices)
    assert library.chapter(novel.id, latest.chapter_id).version.text == latest.text


def test_automatic_facts_and_their_evidence_are_trimmed_together(library, generation):
    novel = library.create_novel(dto.NovelInput(title="记忆预算"))

    def facts(version, chapter):
        shared = version.paragraphs[0]
        return [dto.MemoryProposal(claim="过往行程：" + p.text, evidence=[
            {"source_id": source_for(version, chapter, item.model_dump())["source_id"], "quote": item.text}
            for item in (shared, p)]) for p in version.paragraphs[1:]]

    _, old = confirmed(library, novel.id, "行程", long_prose("途中"), facts)
    confirmed(library, novel.id, "靠岸", "船队靠岸。")
    _, latest = confirmed(library, novel.id, "休息", "众人睡下了。")
    current = library.create_chapter(novel.id, dto.ChapterInput(title="次日"))
    small_window(library)

    preview, _ = prepare(library, novel, current)

    assert 0 < len(preview.facts) < len(old.paragraphs)
    source_ids = {s.source_id for s in preview.sources}
    evidence_ids = {e.source_id for f in preview.facts for e in f.evidence}
    assert evidence_ids <= source_ids
    shared_id = f"{old.id}:{old.paragraphs[0].paragraph_id}"
    assert shared_id in evidence_ids
    assert sum(s.source_id == shared_id for s in preview.sources) == 1
    assert {s.source_id for s in preview.sources if s.version_id == old.id} == evidence_ids
    assert any(s.version_id == latest.id for s in preview.sources)
    assert any("预算" in notice and "记忆" in notice for notice in preview.notices)
    assert len(library.facts(novel.id)) == len(old.paragraphs) - 1


def test_explicit_pins_still_block_instead_of_being_silently_trimmed(library, generation):
    novel = library.create_novel(dto.NovelInput(title="必读预算"))
    old, version = confirmed(library, novel.id, "旧事", long_prose("上午"))
    latest, latest_version = confirmed(library, novel.id, "夜宿", long_prose("夜晚"))
    current = library.create_chapter(novel.id, dto.ChapterInput(title="继续"))
    ChapterReferences(library.ws).save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0,
        selection=dto.ReferenceSelection(chapters=[dto.ChapterReferenceVersion(
            chapter_id=old.id, version_id=version.id), dto.ChapterReferenceVersion(
            chapter_id=latest.id, version_id=latest_version.id)])))
    small_window(library)

    with pytest.raises(DomainError) as error:
        prepare(library, novel, library.chapter(novel.id, current.id))
    assert error.value.code == "CONTEXT_TOO_LARGE"
