import asyncio

import pytest

from app import schemas as dto
from app.domain import DomainError, digest, uid
from app.models import Job
from app.providers import StreamPart


def test_scene_is_a_frozen_candidate_appended_only_on_adoption(library, generation, workspace, monkeypatch):
    async def complete(*args):
        yield StreamPart(text='守塔人挡住了楼梯，要求林舟交出钥匙。')
        yield StreamPart(finish='stop')
    monkeypatch.setattr('app.jobs.stream_completion', complete)
    novel = library.create_novel(dto.NovelInput(title='逐场写作'))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title='登塔'))
    saved = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
        operation_id=uid('save'), text='林舟推开灯塔的门。'))
    scene = dto.SceneIntent(goal='与守塔人交涉', conflict='守塔人不肯放行', ending='停在交出钥匙之前')
    data = dto.JobInput(task='continue', chapter_id=chapter.id, base_version_id=saved.id,
        scene=scene, target_chars=800, idempotency_key=uid('scene'))
    preview = generation.preview(novel.id, data)
    assert preview.scene == scene
    job = generation.create(novel.id, data)
    with workspace.session() as session:
        frozen = session.get(Job, job.id).context
    assert frozen['prompt_version'] == 'scene-v1'
    assert frozen['input']['scene_intent_not_facts'] == scene.model_dump()
    asyncio.run(generation._execute(*generation.claim()))
    assert library.chapter(novel.id, chapter.id).version.text == saved.text
    adopted = generation.adopt(novel.id, job.id, saved.id)
    assert adopted.text.startswith(saved.text) and '守塔人挡住了楼梯' in adopted.text
    assert generation.adopt(novel.id, job.id, saved.id).id == adopted.id
    assert library.version(novel.id, chapter.id, saved.id).text == saved.text
    invalid = data.model_copy(update={'task': 'review', 'idempotency_key': uid('invalid')})
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, invalid)
    assert error.value.code == 'SCENE_SCOPE'


def test_pre_scene_job_receipt_still_replays_without_creating_another_job(library, generation, workspace):
    novel = library.create_novel(dto.NovelInput(title='旧请求回执'))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title='第一章'))
    data = dto.JobInput(task='continue', chapter_id=chapter.id,
        base_version_id=chapter.working_version_id, idempotency_key=uid('old'))
    job = generation.create(novel.id, data)
    legacy = data.model_dump()
    legacy.pop('scene')
    with workspace.session(write=True) as session:
        session.get(Job, job.id).request_hash = digest(legacy)
    assert generation.create(novel.id, data).id == job.id
    changed = data.model_copy(update={'scene': dto.SceneIntent(goal='改变任务范围')})
    with pytest.raises(DomainError) as error:
        generation.create(novel.id, changed)
    assert error.value.code == 'IDEMPOTENCY_CONFLICT'
