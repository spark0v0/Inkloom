from sqlalchemy import event

from app import schemas as dto
from app.domain import char_count, uid


def test_summaries_count_only_current_manuscripts_and_valid_finalizations(library):
    empty = library.create_novel(dto.NovelInput(title="空书"))
    novel = library.create_novel(dto.NovelInput(title="版本统计"))
    first = library.create_chapter(novel.id, dto.ChapterInput(title="第一章"))
    library.create_chapter(novel.id, dto.ChapterInput(title="空白第二章"))
    prior = library.save(novel.id, first.id, dto.SaveInput(
        base_version_id=first.working_version_id, operation_id=uid("save"), text="旧版本。"))
    body = "当前版本包含中文、ABC 和 emoji😀。"
    current = library.save(novel.id, first.id, dto.SaveInput(
        base_version_id=prior.id, operation_id=uid("save"), text=body))
    library.confirm(novel.id, first.id, dto.CanonInput(
        version_id=current.id, operation_id=uid("canon"), changes=[]))

    summaries = {row.id: row for row in library.novels()}
    assert (summaries[empty.id].chapter_count, summaries[empty.id].accepted_count,
            summaries[empty.id].total_chars) == (0, 0, 0)
    assert (summaries[novel.id].chapter_count, summaries[novel.id].accepted_count,
            summaries[novel.id].total_chars) == (2, 1, char_count(body))
    assert summaries[novel.id] == library.novel(novel.id)

    library.save(novel.id, first.id, dto.SaveInput(
        base_version_id=current.id, operation_id=uid("save"), text="改稿后待复核。"))
    changed = next(row for row in library.novels() if row.id == novel.id)
    assert (changed.chapter_count, changed.accepted_count, changed.total_chars) == (
        2, 0, char_count("改稿后待复核。"))
    library.edit_novel(novel.id, dto.NovelPatch(archived=True))
    assert [row.id for row in library.novels()] == [empty.id]
    assert library.novels(archived=True) == [library.novel(novel.id)]


def test_library_projects_statistics_in_one_query_without_chapter_payloads(library, workspace):
    for index in range(4):
        novel = library.create_novel(dto.NovelInput(title=f"作品 {index}"))
        library.create_chapter(novel.id, dto.ChapterInput(title="第一章", goal="长篇细纲" * 1000))
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(workspace.db.engine, "before_cursor_execute", record)
    try:
        summaries = library.novels()
    finally:
        event.remove(workspace.db.engine, "before_cursor_execute", record)
    assert len(summaries) == 4
    assert len(statements) == 1
    assert "chapters.goal" not in statements[0]
    assert "versions.text" not in statements[0]
