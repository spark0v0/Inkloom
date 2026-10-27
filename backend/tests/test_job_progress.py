"""Progress and SSE polling must not read frozen contexts or historical prose."""
import json

import pytest
from sqlalchemy import event

from app import schemas as dto
from app.domain import DomainError, uid
from app.models import Attempt, Job


def setup(library, generation, workspace):
    novel = library.create_novel(dto.NovelInput(title='进度验收'))
    chapter = library.create_chapter(novel.id, dto.ChapterInput())
    job = generation.create(novel.id, dto.JobInput(task='continue', chapter_id=chapter.id,
        base_version_id=chapter.working_version_id, idempotency_key=uid('job')))
    with workspace.session(write=True) as session:
        row = session.get(Job, job.id)
        row.state, row.output_text, row.attempt_count = 'running', '当前片段😀', 1
        row.context = {**row.context, 'test_history': '仅完整详情读取' * 10000}
        session.add(Attempt(id=uid('attempt'), job_id=job.id, number=1, output_text='旧稿' * 20000))
    return novel, job


def test_progress_and_events_query_only_needed_columns(library, generation, workspace):
    novel, job = setup(library, generation, workspace)
    queries = []

    def record(_connection, _cursor, statement, *_args):
        queries.append(statement)

    event.listen(workspace.db.engine, 'before_cursor_execute', record)
    try:
        value = generation.progress(novel.id, job.id)
        assert generation.state(novel.id, job.id) == 'running'
        events, state = generation.events(novel.id, job.id, 0)
    finally:
        event.remove(workspace.db.engine, 'before_cursor_execute', record)
    assert value.output_text == '当前片段😀' and value.attempt_count == 1
    assert events and state == 'running'
    assert all('jobs.context' not in q and 'jobs.result' not in q and 'FROM attempts' not in q for q in queries)
    assert len(value.model_dump_json()) < 1000
    assert len(json.dumps(generation.get(novel.id, job.id).model_dump(), ensure_ascii=False).encode('utf-8')) > 100000
    with pytest.raises(DomainError) as error:
        generation.progress('another-novel', job.id)
    assert error.value.code == 'JOB_NOT_FOUND'
    with pytest.raises(DomainError):
        generation.events('another-novel', job.id, 0)


def test_progress_http_is_read_only_and_checks_workspace_and_novel(client):
    novel = client.post('/api/v1/novels', json={'title': '接口进度'}).json()
    chapter = client.post(f"/api/v1/novels/{novel['id']}/chapters", json={}).json()
    created = client.post(f"/api/v1/novels/{novel['id']}/jobs", json={'task': 'continue', 'chapter_id': chapter['id'],
        'base_version_id': chapter['working_version_id'], 'idempotency_key': uid('job')})
    assert created.status_code == 202
    job = created.json()
    path = f"/api/v1/jobs/{job['id']}/progress?novel_id={novel['id']}"
    response = client.get(path)
    assert response.status_code == 200 and response.json()['state'] == 'queued'
    assert not {'context', 'attempts', 'result'} & response.json().keys()
    assert client.get(path.replace(novel['id'], 'other')).status_code == 404
    assert client.get(path, headers={'X-Inkloom-Workspace': 'other'}).status_code == 409
    assert client.get(f"/api/v1/jobs/{job['id']}?novel_id={novel['id']}").json()['attempt_count'] == 0
