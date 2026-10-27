import io
import json
import sqlite3
import zipfile

import pytest

from app import schemas as dto
from app.context import context_current
from app.domain import DomainError, uid
from app.models import Job, Provider
from app.workspace_io import activate_restore, backup, restore
from app.writing_preferences import save_writing_style


def setup(library):
    novel = library.create_novel(dto.NovelInput(title='文风验收', style='已有作者要求'))
    chapter = library.create_chapter(novel.id, dto.ChapterInput())
    version = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
        operation_id=uid('save'), text='林舟关上窗。\n\n他在桌前坐下。'))
    return novel, chapter, version


def style(novel, **updates):
    return dto.WritingStyleInput(base_settings_revision=novel.settings_revision, style='用行动推动情节。',
        preferences=dto.WritingPreferences(viewpoint='third_person_limited', avoid='重复解释动机',
            example='示例秘密：旧钟楼藏着银钥匙。'), **updates)


def test_style_is_scoped_conflict_checked_and_invalidates_old_candidates(library, generation, workspace):
    novel, chapter, version = setup(library)
    request = dto.JobInput(task='continue', chapter_id=chapter.id, base_version_id=version.id, idempotency_key=uid('job'))
    job = generation.create(novel.id, request)
    data = style(novel)
    saved = save_writing_style(workspace, novel.id, data)
    assert saved.settings_revision == novel.settings_revision + 1
    assert save_writing_style(workspace, novel.id, data).settings_revision == saved.settings_revision
    with pytest.raises(DomainError) as conflict:
        save_writing_style(workspace, novel.id, data.model_copy(update={'style': '旧窗口另一个要求'}))
    assert conflict.value.code == 'WRITING_STYLE_CONFLICT'
    with workspace.session() as session:
        assert not context_current(session, session.get(Job, job.id))
    other = library.create_novel(dto.NovelInput(title='另一本书'))
    assert library.novel(other.id).writing_preferences == dto.WritingPreferences()
    assert library.chapter(novel.id, chapter.id).version.text == version.text
    assert library.facts(novel.id) == []


def test_style_sample_is_not_fact_or_extraction_input_and_counts_towards_budget(library, generation, workspace):
    novel, chapter, version = setup(library)
    save_writing_style(workspace, novel.id, style(novel))
    request = dto.ContextInput(task='continue', chapter_id=chapter.id, base_version_id=version.id)
    preview = generation.preview(novel.id, request)
    assert preview.writing_preferences.example.startswith('示例秘密')
    assert preview.facts == [] and all('银钥匙' not in s.text for s in preview.sources)
    job = generation.create(novel.id, dto.JobInput(**request.model_dump(), idempotency_key=uid('job')))
    with workspace.session() as session:
        payload = json.loads(session.get(Job, job.id).context['messages'][-1]['content'])
        assert payload['writing_preferences']['example']['status'] == 'author_supplied_noncanonical_style_sample'
    extraction = generation.preview(novel.id, request.model_copy(update={'task': 'extract'}))
    assert extraction.writing_preferences is None
    with workspace.session(write=True) as session:
        provider = session.get(Provider, 'demo')
        provider.context_window = preview.estimated_input_tokens + preview.max_output_tokens + 512 - 1
    with pytest.raises(DomainError) as oversized:
        generation.preview(novel.id, request)
    assert oversized.value.code == 'CONTEXT_TOO_LARGE'


def test_style_backup_round_trip_and_c84_upgrade(library, workspace, tmp_path):
    novel, chapter, version = setup(library)
    saved = save_writing_style(workspace, novel.id, style(novel))
    archive = backup(workspace)
    result = restore(workspace, archive)
    activate_restore(workspace, result['restore_id'])
    assert library.novel(novel.id).writing_preferences == saved.writing_preferences
    # Build a genuine pre-feature schema inside an isolated archive.
    with zipfile.ZipFile(io.BytesIO(archive)) as contents:
        manifest = json.loads(contents.read('manifest.json'))
        database = tmp_path / 'before-writing-style.db'
        database.write_bytes(contents.read('workspace.db'))
    with sqlite3.connect(database) as connection:
        connection.execute('DROP TABLE outline_revisions')
        connection.execute('ALTER TABLE chapters DROP COLUMN outline_revision')
        connection.execute('ALTER TABLE novels DROP COLUMN writing_preferences')
        connection.execute("UPDATE alembic_version SET version_num='c84e3a190b72'")
        connection.commit()
        raw = connection.serialize()
    import hashlib
    manifest['schema_revision'] = 'c84e3a190b72'
    manifest['files']['workspace.db'] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as contents:
        contents.writestr('manifest.json', json.dumps(manifest))
        contents.writestr('workspace.db', raw)
    result = restore(workspace, output.getvalue())
    activate_restore(workspace, result['restore_id'])
    assert library.novel(novel.id).style == saved.style
    assert library.novel(novel.id).writing_preferences == dto.WritingPreferences()
    assert library.chapter(novel.id, chapter.id).version.text == version.text


def test_style_endpoint_and_length_validation(client):
    novel = client.post('/api/v1/novels', json={'title': '风格接口'}).json()
    path = f"/api/v1/novels/{novel['id']}/writing-style"
    response = client.put(path, json={'base_settings_revision': novel['settings_revision'],
        'style': '保持已有风格', 'preferences': {'viewpoint': 'first_person', 'example': '我的表达示例'}})
    assert response.status_code == 200
    assert response.json()['writing_preferences']['viewpoint'] == 'first_person'
    assert client.put(path, json={'base_settings_revision': 0, 'preferences': {'example': 'x' * 4001}}).status_code == 422
