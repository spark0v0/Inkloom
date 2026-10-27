import asyncio
import io
import json
import sqlite3
import zipfile

import pytest

from app import schemas as dto
from app.chapter_outlines import ChapterOutlines, render_document
from app.context import validate_result
from app.domain import DomainError, uid
from app.models import Plan
from app.providers import StreamPart, demo_text
from app.workspace_io import activate_restore, backup, restore


def setup(library, workspace):
    novel = library.create_novel(dto.NovelInput(title='细纲验收'))
    document = dto.StructuredOutline(kind='structured', title='第1章 归来', goal='找到原始账本', conflict='守门人拒绝进入',
        beats=['调查侧门', '发现新锁'], ending_hook='锁上刻着父亲的名字')
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title=document.title, goal=render_document(document)))
    with workspace.session(write=True) as session:
        session.add(Plan(id=uid('plan'), novel_id=novel.id, level='chapter', position=1,
            title=document.title, body=render_document(document), structure={'kind': 'chapter_outline',
                'chapter_id': chapter.id, 'number': 1, **document.model_dump(exclude={'kind'})}))
    return novel, chapter, document, ChapterOutlines(workspace)


def save(service, novel, chapter, document, base=0, operation_id=None):
    return service.save(novel.id, chapter.id, dto.OutlineUpdate(base_revision=base,
        operation_id=operation_id or uid('save'), document=document))


def test_manual_revision_conflict_idempotence_and_metadata_preserve_structure(library, workspace):
    novel, chapter, document, service = setup(library, workspace)
    operation = uid('save')
    changed = document.model_copy(update={'ending_hook': '侧门从里面被打开'})
    saved = save(service, novel, chapter, changed, operation_id=operation)
    assert saved.revision == 1
    assert save(service, novel, chapter, changed, operation_id=operation) == saved
    with pytest.raises(DomainError) as error:
        save(service, novel, chapter, document)
    assert error.value.code == 'OUTLINE_CONFLICT'
    renamed = library.edit_chapter(novel.id, chapter.id, dto.ChapterPatch(title='第1章 来信', volume='新卷'))
    current = service.get(novel.id, chapter.id)
    assert current.revision == 2 and current.document.kind == 'structured'
    assert current.document.ending_hook == changed.ending_hook
    library.edit_chapter(novel.id, chapter.id, dto.ChapterPatch(volume='另一卷'))
    assert service.get(novel.id, chapter.id).revision == 2
    assert renamed.working_version_id == chapter.working_version_id
    assert library.chapter(novel.id, chapter.id).version.text == ''
    assert service.revision(novel.id, chapter.id, 0).document == document
    plan = library.plans(novel.id)[0]
    library.put_plan(novel.id, dto.PlanInput(title=plan.title + ' 改名', level='chapter', body=plan.body), plan.id)
    assert service.get(novel.id, chapter.id).document.kind == 'structured'


def test_legacy_text_stays_exact_and_restoration_creates_a_new_revision(library, workspace):
    novel, chapter, document, service = setup(library, workspace)
    raw = '作者自由记录\n冲突：此处是对白内容，不自动拆字段。\n\n😀'
    library.edit_chapter(novel.id, chapter.id, dto.ChapterPatch(goal=raw))
    assert service.get(novel.id, chapter.id).document == dto.TextOutline(kind='text', title=chapter.title, text=raw)
    restored = service.restore(novel.id, chapter.id, 0, dto.OutlineRestoreInput(base_revision=1, operation_id=uid('restore')))
    assert restored.revision == 2 and restored.document == document
    assert service.revision(novel.id, chapter.id, 1).document.text == raw
    assert [item.revision for item in service.history(novel.id, chapter.id).items] == [2, 1, 0]
    with pytest.raises(DomainError):
        service.revision('other-book', chapter.id, 0)
    empty = dto.TextOutline(kind='text', title=chapter.title, text='')
    save(service, novel, chapter, empty, base=2)
    assert service.get(novel.id, chapter.id).document == empty


def test_ai_scope_selective_adoption_and_changed_baseline(library, generation, workspace, monkeypatch):
    novel, chapter, document, service = setup(library, workspace)

    async def complete(_config, _key, _messages, task, context):
        yield StreamPart(text=demo_text(task, context))
        yield StreamPart(finish='stop')
    monkeypatch.setattr('app.jobs.stream_completion', complete)

    def generate(fields):
        value = service.get(novel.id, chapter.id)
        job = generation.create(novel.id, dto.JobInput(task='outline_edit', chapter_id=chapter.id,
            base_version_id=chapter.working_version_id, idempotency_key=uid('job'),
            outline_edit=dto.OutlineEditReference(base_revision=value.revision, fields=fields)))
        asyncio.run(generation._execute(*generation.claim()))
        return generation.get(novel.id, job.id)
    job = generate(['conflict', 'ending_hook'])
    assert job.state == 'succeeded'
    adopted = dto.OutlineApplyInput(base_revision=0, operation_id=uid('adopt'), fields=['ending_hook'])
    result = service.adopt(novel.id, job.id, adopted)
    assert result.document.conflict == document.conflict
    assert result.document.ending_hook.startswith('演示建议')
    assert service.adopt(novel.id, job.id, adopted) == result
    assert library.chapter(novel.id, chapter.id).version.text == '' and library.facts(novel.id) == []
    old = generate(['conflict'])
    current = service.get(novel.id, chapter.id)
    save(service, novel, chapter, current.document.model_copy(update={'goal': '新目标'}), current.revision)
    with pytest.raises(DomainError) as stale:
        service.adopt(novel.id, old.id, dto.OutlineApplyInput(base_revision=current.revision, operation_id=uid('adopt'), fields=['conflict']))
    assert stale.value.code == 'CONTEXT_STALE'
    from app.models import Job
    with workspace.session() as session:
        context = session.get(Job, old.id).context
    raw_result = old.result.model_dump()
    malicious = {**raw_result, 'document': {**raw_result['document'], 'goal': '偷偷修改未选字段'}}
    with pytest.raises(DomainError) as scope:
        validate_result('outline_edit', malicious, context)
    assert scope.value.code == 'OUTLINE_SCOPE_CHANGED'


def test_backup_history_roundtrip_old_upgrade_and_tamper_rejection(library, workspace, tmp_path):
    novel, chapter, document, service = setup(library, workspace)
    save(service, novel, chapter, document.model_copy(update={'conflict': '改后的冲突'}))
    contents = backup(workspace)
    target = restore(workspace, contents)
    activate_restore(workspace, target['restore_id'])
    assert service.get(novel.id, chapter.id).revision == 1
    assert service.revision(novel.id, chapter.id, 0).document == document
    with zipfile.ZipFile(io.BytesIO(contents)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        path = tmp_path / 'old.db'
        path.write_bytes(archive.read('workspace.db'))

    def archive_database(schema):
        with sqlite3.connect(path) as connection:
            raw = connection.serialize()
        manifest['schema_revision'] = schema
        manifest['files']['workspace.db'] = {'bytes': len(raw), 'sha256': __import__('hashlib').sha256(raw).hexdigest()}
        result = io.BytesIO()
        with zipfile.ZipFile(result, 'w') as archive:
            archive.writestr('manifest.json', json.dumps(manifest))
            archive.writestr('workspace.db', raw)
        return result.getvalue()
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE outline_revisions SET content_hash='wrong' WHERE revision=0")
    with pytest.raises(DomainError):
        restore(workspace, archive_database('e06a5c318d94'))
    with sqlite3.connect(path) as connection:
        connection.execute('DROP TABLE outline_revisions')
        connection.execute('ALTER TABLE chapters DROP COLUMN outline_revision')
        connection.execute("UPDATE alembic_version SET version_num='d95f4b207c83'")
    target = restore(workspace, archive_database('d95f4b207c83'))
    activate_restore(workspace, target['restore_id'])
    assert service.get(novel.id, chapter.id).revision == 0
    assert service.get(novel.id, chapter.id).document.conflict == '改后的冲突'


def test_outline_http_validation_and_no_model_calls(client):
    novel = client.post('/api/v1/novels', json={'title': '细纲接口'}).json()
    chapter = client.post(f"/api/v1/novels/{novel['id']}/chapters", json={}).json()
    path = f"/api/v1/novels/{novel['id']}/chapters/{chapter['id']}/outline"
    value = client.get(path).json()
    body = {'base_revision': 0, 'operation_id': uid('save'),
        'document': {**value['document'], 'goal': '改变目标'}}
    assert client.put(path, json=body).status_code == 200
    assert client.put(path, json={**body, 'operation_id': uid('save')}).status_code == 409
    assert client.get(path.replace(novel['id'], 'another')).status_code == 404
    assert client.get(path, headers={'X-Inkloom-Workspace': 'other'}).status_code == 409
    assert client.get(f"/api/v1/jobs?novel_id={novel['id']}").json() == []
