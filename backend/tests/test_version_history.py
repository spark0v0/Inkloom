import pytest
from sqlalchemy import event

from app import schemas as dto
from app.domain import DomainError, uid
from app.models import Version


def test_history_pages_only_load_metadata_with_stable_ties(library, workspace):
    novel = library.create_novel(dto.NovelInput(title="保存历史"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="第一章"))
    with workspace.session(write=True) as session:
        source = session.get(Version, chapter.working_version_id)
        for index in range(64):
            session.add(Version(id=f"version_{index:03}", chapter_id=chapter.id,
                operation_id=uid("save"), request_hash=uid("request"),
                parent_id=source.id, char_count=5000, content_hash=uid("hash"),
                text="不应加载的正文" * 5000, editor_doc={}, paragraphs=[], created_at=source.created_at))
    statements = []

    def trace(conn, cursor, statement, parameters, context, many):
        statements.append(statement)
    event.listen(workspace.db.engine, "before_cursor_execute", trace)
    try:
        first = library.version_history(novel.id, chapter.id)
        second = library.version_history(novel.id, chapter.id, first.next_before)
        third = library.version_history(novel.id, chapter.id, second.next_before)
        legacy = library.versions(novel.id, chapter.id)
    finally:
        event.remove(workspace.db.engine, "before_cursor_execute", trace)
    ids = [item.id for page in [first, second, third] for item in page.items]
    assert [len(page.items) for page in [first, second, third]] == [30, 30, 5]
    assert len(set(ids)) == 65 and third.next_before is None
    assert [item.id for item in legacy] == ids
    assert not any(any(field in sql for field in ['versions.text', 'versions.editor_doc', 'versions.paragraphs'])
                   for sql in statements)
    foreign = library.create_novel(dto.NovelInput(title="另一本书"))
    other = library.create_chapter(foreign.id, dto.ChapterInput(title="另一章"))
    with pytest.raises(DomainError) as error:
        library.version_history(novel.id, chapter.id, other.working_version_id)
    assert error.value.code == "INVALID_VERSION_CURSOR"
