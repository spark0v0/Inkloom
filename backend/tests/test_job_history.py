"""Cursor history must retain early records without loading manuscript payloads."""
import pytest
from sqlalchemy import event

from app import schemas as dto
from app.domain import DomainError, uid
from app.models import Job


def history(library, generation, workspace, count=163):
    novel = library.create_novel(dto.NovelInput(title="历史之书"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="早章检索"))
    with workspace.session(write=True) as session:
        for i in range(count):
            session.add(Job(id=f"history_{i:04}", novel_id=novel.id, chapter_id=chapter.id,
                task="review" if i % 2 else "rewrite", instruction=f"要求 {i} " + ("100%_原样" if i == 0 else "100xxx原样"),
                provider_id="demo", state="failed" if i % 2 else "succeeded", idempotency_key=uid("history"),
                request_hash=uid("hash"), base_version_id=chapter.working_version_id,
                context={"large": "DO_NOT_READ_CONTEXT" * 100}, output_text="DO_NOT_READ_PROSE" * 100,
                created_at="2026-10-01T00:00:00+00:00"))
    return novel, chapter


def test_cursor_reads_beyond_150_without_duplicates_even_with_equal_timestamps(library, generation, workspace):
    novel, _ = history(library, generation, workspace)
    found, cursor = [], None
    for _ in range(8):
        page = generation.history(novel_id=novel.id, limit=37, cursor=cursor)
        found.extend(row.id for row in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break
    assert found == [f"history_{i:04}" for i in range(162, -1, -1)]
    assert len(set(found)) == 163


def test_history_queries_only_summary_columns(library, generation, workspace):
    novel, _ = history(library, generation, workspace, 3)
    statements = []
    def record(connection, cursor, statement, *args):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement.lower())
    event.listen(workspace.db.engine, "before_cursor_execute", record)
    try:
        page = generation.history(novel_id=novel.id)
    finally:
        event.remove(workspace.db.engine, "before_cursor_execute", record)
    assert page.items[0].novel_title == "历史之书" and page.items[0].chapter_title == "早章检索"
    assert "DO_NOT_READ" not in page.model_dump_json()
    assert not any("jobs.context" in sql or "jobs.output_text" in sql or "jobs.result" in sql for sql in statements)


def test_search_filters_and_cursor_are_bound_to_scope(library, generation, workspace):
    novel, chapter = history(library, generation, workspace)
    page = generation.history(novel_id=novel.id, task="review", state="failed", query="早章", limit=10)
    assert len(page.items) == 10 and all(row.task == "review" and row.state == "failed" for row in page.items)
    with pytest.raises(DomainError) as error:
        generation.history(novel_id=novel.id, task="rewrite", cursor=page.next_cursor)
    assert error.value.code == "CURSOR_SCOPE"
    exact = generation.history(novel_id=novel.id, query="100%_原样")
    assert [row.id for row in exact.items] == ["history_0000"]
    other = library.create_novel(dto.NovelInput(title="空作品"))
    assert generation.history(novel_id=other.id).items == []
    with pytest.raises(DomainError):
        generation.history(novel_id=other.id, chapter_id=chapter.id)


@pytest.mark.parametrize("cursor", ["", "bad_cursor", "e30=", "a" * 1000])
def test_invalid_cursor_is_an_explicit_error(library, generation, workspace, cursor):
    novel, _ = history(library, generation, workspace, 1)
    with pytest.raises(DomainError) as error:
        generation.history(novel_id=novel.id, cursor=cursor)
    assert error.value.code == "INVALID_CURSOR"


def test_history_api_route_and_input_validation(client):
    response = client.get("/api/v1/jobs/page")
    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}
    assert client.get("/api/v1/jobs/page?limit=101").status_code == 422
    assert client.get("/api/v1/jobs/page?state=unknown").status_code == 422
    assert client.get("/api/v1/jobs/page?chapter_id=missing").status_code == 400
