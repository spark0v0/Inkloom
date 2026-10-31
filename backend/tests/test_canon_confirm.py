import pytest

from app import schemas as dto
from app.domain import DomainError, uid


def prepared_story(library):
    novel = library.create_novel(dto.NovelInput(title='定稿回执测试'))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title='第一章'))
    version = library.save(novel.id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id, operation_id=uid('save'), text='林舟把钥匙交给守塔人。'))
    change = dto.MemoryProposal(kind='event', claim='作者确认钥匙已转交。', evidence=[{
        'source_id': f'{version.id}:{version.paragraphs[0].paragraph_id}', 'quote': version.text}])
    library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id,
        operation_id=uid('confirm'), changes=[change]))
    return novel, chapter, version, change


def test_confirming_identical_memory_does_not_invalidate_the_next_chapter(library):
    novel, chapter, version, change = prepared_story(library)
    second = library.create_chapter(novel.id, dto.ChapterInput(title='第二章'))
    body = library.save(novel.id, second.id, dto.SaveInput(base_version_id=second.working_version_id,
        operation_id=uid('save'), text='守塔人用钥匙打开了楼梯间。'))
    latest = library.confirm(novel.id, second.id, dto.CanonInput(version_id=body.id, operation_id=uid('confirm')))
    repeated = library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id,
        operation_id=uid('confirm'), changes=[change]))
    assert repeated.revision == latest.revision
    assert library.chapter(novel.id, second.id).review_state == 'confirmed'


def test_changed_memory_cannot_overwrite_a_confirmed_chapter_without_a_baseline(library):
    novel, chapter, version, _ = prepared_story(library)
    with pytest.raises(DomainError) as error:
        library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id,
            operation_id=uid('confirm'), changes=[]))
    assert error.value.code == 'CANON_CONFLICT'
    assert len(library.facts(novel.id)) == 1


def test_preparation_restores_author_memory_and_rejects_a_stale_edit(library):
    novel, chapter, version, change = prepared_story(library)
    basis = library.prepare_canon(novel.id, chapter.id)
    assert basis.confirmed and basis.version_id == version.id
    assert [row.claim for row in basis.changes] == [change.claim]
    assert basis.changes[0].evidence[0].version_id == version.id
    changed = change.model_copy(update={'claim': '作者修改了记忆概括，引用保持原文。'})
    library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id,
        operation_id=uid('confirm'), changes=[changed], base_canon_revision=basis.canon_revision))
    with pytest.raises(DomainError) as error:
        library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id,
            operation_id=uid('confirm'), changes=[], base_canon_revision=basis.canon_revision))
    assert error.value.code == 'CANON_CONFLICT'
    assert library.prepare_canon(novel.id, chapter.id).changes[0].claim == changed.claim


def test_prepared_evidence_metadata_does_not_make_unchanged_memory_a_new_revision(library):
    novel, chapter, version, _ = prepared_story(library)
    basis = library.prepare_canon(novel.id, chapter.id)
    result = library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id,
        operation_id=uid('confirm'), changes=basis.changes, base_canon_revision=basis.canon_revision))
    assert result.revision == basis.canon_revision
    assert len(library.facts(novel.id)) == 1
