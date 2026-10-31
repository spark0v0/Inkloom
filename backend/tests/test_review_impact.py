import pytest
from sqlalchemy import event

from app import schemas as dto
from app.domain import DomainError, uid
from app.review_impact import review_impact


def test_review_list_is_read_only_paginated_and_reports_explicit_dependencies(library, workspace):
    novel = library.create_novel(dto.NovelInput(title='改稿复核'))
    first = library.create_chapter(novel.id, dto.ChapterInput(title='交接'))
    old = library.save(novel.id, first.id, dto.SaveInput(base_version_id=first.working_version_id,
        operation_id=uid('save'), text='林舟把钥匙交给守塔人。'))
    library.confirm(novel.id, first.id, dto.CanonInput(version_id=old.id, operation_id=uid('confirm')))
    second = library.create_chapter(novel.id, dto.ChapterInput(title='开门'))
    from app.references import ChapterReferences
    ChapterReferences(workspace).save(novel.id, second.id, dto.ReferenceUpdate(base_revision=0,
        selection=dto.ReferenceSelection(chapters=[dto.ChapterReferenceVersion(chapter_id=first.id, version_id=old.id)])))
    body = library.save(novel.id, second.id, dto.SaveInput(base_version_id=second.working_version_id,
        operation_id=uid('save'), text='守塔人打开了楼梯间。'))
    library.confirm(novel.id, second.id, dto.CanonInput(version_id=body.id, operation_id=uid('confirm')))
    changed = library.save(novel.id, first.id, dto.SaveInput(base_version_id=old.id,
        operation_id=uid('save'), text='林舟把钥匙留在了自己手里。'))
    statements = []
    def record(connection, cursor, statement, *args):
        statements.append(statement.lower())
    event.listen(workspace.db.engine, 'before_cursor_execute', record)
    try:
        with workspace.session() as session:
            page = review_impact(session, novel.id, limit=1)
            more = review_impact(session, novel.id, page.next_after, page.source_fingerprint, limit=1)
    finally:
        event.remove(workspace.db.engine, 'before_cursor_execute', record)
    assert page.total == 2 and page.first_chapter_id == first.id
    assert page.items[0].manuscript_changed
    assert not more.items[0].manuscript_changed
    assert more.items[0].references[0].chapter_id == first.id
    assert not any('versions.text' in sql or 'versions.paragraphs' in sql or 'update ' in sql for sql in statements)
    assert library.chapter(novel.id, second.id).review_state == 'needs_review'
    library.confirm(novel.id, first.id, dto.CanonInput(version_id=changed.id, operation_id=uid('confirm')))
    with workspace.session() as session:
        with pytest.raises(DomainError) as error:
            review_impact(session, novel.id, fingerprint=page.source_fingerprint)
    assert error.value.code == 'REVIEW_IMPACT_CHANGED'
    other = library.create_novel(dto.NovelInput(title='其他书'))
    with workspace.session() as session:
        assert review_impact(session, other.id).total == 0


def test_review_list_http_validation(client):
    assert client.get('/api/v1/novels/missing/review-impact').status_code == 404
    assert client.get('/api/v1/novels/missing/review-impact?after=-1').status_code == 422
