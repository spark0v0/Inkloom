import asyncio
import hashlib
import io
import json
import math
import sqlite3
import zipfile

import pytest
from sqlalchemy import event

from app import schemas as dto
from app.chapter_outlines import ChapterOutlines
from app.context import validate_result
from app.discussion_sources import validate_snapshot
from app.discussions import Discussions
from app.domain import DomainError, uid
from app.models import Job, Provider
from app.providers import StreamPart, demo_text
from app.workspace_io import activate_restore, backup, restore


def test_explicit_manuscript_and_cards_have_verified_sources_and_stale_protection(library, generation, workspace, tmp_path):
    novel, chapter, service, conversation = setup(library, workspace)
    version = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
        operation_id=uid('save'), text='林舟将钥匙交给守塔人。'))
    chapter = library.chapter(novel.id, chapter.id)
    entity = library.put_entity(novel.id, dto.EntityInput(kind='character', name='林舟', body='林舟害怕失去同伴。'))
    data = request(chapter, conversation)
    data.discussion.manuscripts = [dto.ChapterReferenceVersion(chapter_id=chapter.id, version_id=version.id)]
    data.discussion.entity_ids = [entity.id]
    preview = generation.preview(novel.id, data)
    assert preview.discussion_manuscripts[0].version_id == version.id
    assert preview.entities[0].body == entity.body
    assert preview.sources[0].text == version.text and preview.sources[0].kind == 'draft'
    data.discussion = preview.discussion
    job = execute(generation, novel, data)
    with workspace.session() as session:
        snapshot = session.get(Job, job.id).context
    raw = {'kind': 'discussion', 'reply': '主角已经交出钥匙。', 'proposal': None,
        'referenced_chapter_ids': [chapter.id], 'evidence': [{'source_id': preview.sources[0].source_id, 'quote': '钥匙'}]}
    checked = validate_result('discuss', raw, snapshot)
    assert checked['evidence'][0]['version_id'] == version.id
    raw['evidence'][0]['quote'] = '正文中不存在的句子'
    with pytest.raises(DomainError, match='引用不能'):
        validate_result('discuss', raw, snapshot)
    archive = backup(workspace)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        database = tmp_path / 'discussion-snapshot.db'
        database.write_bytes(zipped.read('workspace.db'))
    with sqlite3.connect(database) as connection:
        tampered = json.loads(json.dumps(snapshot))
        tampered['input']['sources'][0]['text'] = '伪造的原文'
        tampered['preview']['sources'][0]['text'] = '伪造的原文'
        with pytest.raises(DomainError, match='不可变正文'):
            validate_snapshot(connection, novel.id, data.discussion, tampered)
    restored = restore(workspace, archive)
    activate_restore(workspace, restored['restore_id'])
    assert service.get(novel.id, conversation.id).items[0].id == job.id
    library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=version.id,
        operation_id=uid('save'), text='林舟收回钥匙，决定独自登塔。'))
    assert generation.get(novel.id, job.id).candidate_status == 'needs_rebase'
    with pytest.raises(DomainError, match='已变化'):
        service.adopt(novel.id, job.id, dto.OutlineApplyInput(base_revision=0, fields=['text'], operation_id=uid('apply')))


def test_discussion_materials_are_opt_in_isolated_and_never_silently_trimmed(library, generation, workspace):
    novel, chapter, _, conversation = setup(library, workspace)
    version = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
        operation_id=uid('save'), text='只在明确选择后才发送的正文。' * 4000))
    chapter = library.chapter(novel.id, chapter.id)
    data = request(chapter, conversation)
    assert generation.preview(novel.id, data).sources == []
    data.discussion.manuscripts = [dto.ChapterReferenceVersion(chapter_id=chapter.id, version_id=version.id)]
    with workspace.session(write=True) as session:
        session.get(Provider, 'demo').context_window = 4000
    with pytest.raises(DomainError, match='超出模型容量'):
        generation.preview(novel.id, data)
    other = library.create_novel(dto.NovelInput(title='另一本书'))
    foreign = library.create_chapter(other.id, dto.ChapterInput(title='同名章节'))
    data.discussion.manuscripts = [dto.ChapterReferenceVersion(chapter_id=foreign.id, version_id=foreign.working_version_id)]
    with pytest.raises(DomainError, match='此作品中没有'):
        generation.preview(novel.id, data)
    data.discussion.manuscripts = []
    entity = library.put_entity(other.id, dto.EntityInput(kind='character', name='同名人物'))
    data.discussion.entity_ids = [entity.id]
    with pytest.raises(DomainError, match='本书'):
        generation.preview(novel.id, data)


def test_a_selected_manuscript_change_after_preview_rejects_sending(library, generation, workspace):
    novel, chapter, _, conversation = setup(library, workspace)
    other = library.create_chapter(novel.id, dto.ChapterInput(title='需要讨论的正文'))
    old = library.save(novel.id, other.id, dto.SaveInput(base_version_id=other.working_version_id,
        operation_id=uid('save'), text='林舟把钥匙放在桌上。'))
    data = request(chapter, conversation)
    data.discussion.manuscripts = [dto.ChapterReferenceVersion(chapter_id=other.id, version_id=old.id)]
    data.discussion = generation.preview(novel.id, data).discussion
    library.save(novel.id, other.id, dto.SaveInput(base_version_id=old.id,
        operation_id=uid('save'), text='林舟把钥匙收回口袋。'))
    with pytest.raises(DomainError) as error:
        generation.create(novel.id, data)
    assert error.value.code == 'DISCUSSION_CONTEXT_CHANGED'


@pytest.fixture(autouse=True)
def instant_demo(monkeypatch):
    async def complete(config, key, messages, task, context):
        yield StreamPart(text=demo_text(task, context))
        yield StreamPart(finish="stop")
    monkeypatch.setattr("app.jobs.stream_completion", complete)


def setup(library, workspace):
    novel = library.create_novel(dto.NovelInput(title="规划讨论测试"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="来信", goal="寻找寄信人"))
    discussions = Discussions(workspace)
    conversation = discussions.create(novel.id, dto.ConversationInput())
    return novel, chapter, discussions, conversation


def request(chapter, conversation, **changes):
    return dto.JobInput(task="discuss", chapter_id=chapter.id,
        base_version_id=chapter.working_version_id, instruction="主角为什么要行动？",
        discussion=dto.DiscussionReference(conversation_id=conversation.id,
            last_job_id=conversation.last_job_id, chapter_ids=[chapter.id]),
        idempotency_key=uid("send"), **changes)


def execute(generation, novel, data):
    job = generation.create(novel.id, data)
    claimed = generation.claim()
    assert claimed is not None
    asyncio.run(generation._execute(*claimed))
    result = generation.get(novel.id, job.id)
    assert result.state == "succeeded", result.error_message
    return result


def test_conversation_persists_turns_and_explicit_adoption_only(library, generation, workspace):
    novel, chapter, service, conversation = setup(library, workspace)
    outlines = ChapterOutlines(workspace)
    data = request(chapter, conversation)
    preview = generation.preview(novel.id, data)
    assert preview.sources == preview.facts == []
    assert preview.discussion_outlines[0].document.text == "寻找寄信人"
    data.discussion = preview.discussion
    job = execute(generation, novel, data)
    assert service.get(novel.id, conversation.id).items[0].result == job.result
    assert outlines.get(novel.id, chapter.id).revision == 0
    assert library.chapter(novel.id, chapter.id).version.text == ""
    # Lost creation acknowledgement replays the same job without another turn.
    assert generation.create(novel.id, data).id == job.id
    adopt = dto.OutlineApplyInput(base_revision=0, fields=["text"], operation_id=uid("apply"))
    adopted = service.adopt(novel.id, job.id, adopt)
    assert adopted.revision == 1
    assert adopted.document.text != "寻找寄信人"
    assert service.adopt(novel.id, job.id, adopt) == adopted
    assert library.chapter(novel.id, chapter.id).version.text == ""
    assert library.facts(novel.id) == []
    conversation = service.get(novel.id, conversation.id).conversation
    next_job = execute(generation, novel, request(chapter, conversation))
    with workspace.session() as session:
        frozen = session.get(Job, next_job.id).context
        past = frozen["input"]["past_discussions_not_facts"]
        assert past[0]["applied"] is True
        assert past[0]["suggestion"]["reply"] == job.result.reply
        assert frozen["input"]["chapter_outlines"][0]["revision"] == 1
    conversation = service.get(novel.id, conversation.id).conversation
    third = execute(generation, novel, request(chapter, conversation))
    page = Discussions(workspace).get(novel.id, conversation.id)
    assert [item.id for item in page.items] == [third.id, next_job.id, job.id]
    assert page.items[-1].applied
    # Historical proposals stay visible, but a later turn fences their application.
    with pytest.raises(DomainError, match="后续讨论"):
        service.adopt(novel.id, next_job.id, dto.OutlineApplyInput(
            base_revision=1, fields=["text"], operation_id=uid("stale")))
    assert service.adopt(novel.id, job.id, adopt).operation_revision == 1
    # Backups restore both turn order and reviewable proposals.
    restored = restore(workspace, backup(workspace))
    activate_restore(workspace, restored["restore_id"])
    assert [item.id for item in service.get(novel.id, conversation.id).items] == [third.id, next_job.id, job.id]


def test_frozen_preview_stale_outline_and_cross_book_boundaries(library, generation, workspace):
    novel, chapter, service, conversation = setup(library, workspace)
    data = request(chapter, conversation)
    data.discussion = generation.preview(novel.id, data).discussion
    library.edit_chapter(novel.id, chapter.id, dto.ChapterPatch(goal="作者已改了目标"))
    with pytest.raises(DomainError) as error:
        generation.create(novel.id, data)
    assert error.value.code == "DISCUSSION_CONTEXT_CHANGED"
    data = request(chapter, conversation)
    job = execute(generation, novel, data)
    with pytest.raises(DomainError) as error:
        generation.create(novel.id, request(chapter, conversation))
    assert error.value.code == "DISCUSSION_CONFLICT"
    foreign = library.create_novel(dto.NovelInput(title="另一本书"))
    other = library.create_chapter(foreign.id, dto.ChapterInput(title="外部章节"))
    with pytest.raises(DomainError):
        service.get(foreign.id, conversation.id)
    with pytest.raises(DomainError):
        service.get(novel.id, conversation.id, before=uid("unknown"))
    conversation = service.get(novel.id, conversation.id).conversation
    data = request(chapter, conversation)
    data.discussion.chapter_ids.append(other.id)
    with pytest.raises(DomainError):
        generation.preview(novel.id, data)
    library.edit_chapter(novel.id, chapter.id, dto.ChapterPatch(goal="原文再次变化"))
    with pytest.raises(DomainError) as error:
        service.adopt(novel.id, job.id, dto.OutlineApplyInput(
            base_revision=1, fields=["text"], operation_id=uid("apply")))
    assert error.value.code == "DISCUSSION_STALE"


def test_result_scope_and_context_budget(library, generation, workspace):
    novel, chapter, service, conversation = setup(library, workspace)
    job = execute(generation, novel, request(chapter, conversation))
    with workspace.session() as session:
        context = session.get(Job, job.id).context
    result = job.result.model_dump()
    result["proposal"]["document"]["title"] = "未授权改标题"
    with pytest.raises(DomainError):
        validate_result("discuss", result, context)
    result = job.result.model_dump()
    result["referenced_chapter_ids"] = ["foreign"]
    with pytest.raises(DomainError):
        validate_result("discuss", result, context)
    conversation = service.get(novel.id, conversation.id).conversation
    with workspace.session(write=True) as session:
        provider = session.get(Provider, "demo")
        provider.context_window = 1024
        provider.max_output_tokens = 512
    with pytest.raises(DomainError) as error:
        generation.preview(novel.id, request(chapter, conversation))
    assert error.value.code == "CONTEXT_TOO_LARGE"
    assert ChapterOutlines(workspace).get(novel.id, chapter.id).document.text == "寻找寄信人"


def test_cancelled_turn_is_retained_but_not_sent_as_a_reply(library, generation, workspace):
    novel, chapter, service, conversation = setup(library, workspace)
    job = generation.create(novel.id, request(chapter, conversation))
    generation.control(novel.id, job.id, "cancel")
    page = service.get(novel.id, conversation.id)
    assert page.items[0].state == "cancelled" and page.items[0].result is None
    next_job = execute(generation, novel, request(chapter, page.conversation))
    with workspace.session() as session:
        assert session.get(Job, next_job.id).context["input"]["past_discussions_not_facts"] == []


def test_budget_drops_old_discussion_and_optional_plans_before_selected_outlines(library, generation, workspace):
    novel, chapter, service, conversation = setup(library, workspace)
    job = execute(generation, novel, request(chapter, conversation))
    with workspace.session(write=True) as session:
        row = session.get(Job, job.id)
        baseline = row.context["preview"]["estimated_input_tokens"]
        row.result = {**row.result, "reply": "过往建议" * 2000}
        provider = session.get(Provider, "demo")
        provider.context_window = math.ceil((baseline + 512 + 600) / .92)
        provider.max_output_tokens = 512
    library.put_plan(novel.id, dto.PlanInput(title="全书规划", level="book", body="可选的全书规划资料" * 800))
    conversation = service.get(novel.id, conversation.id).conversation
    data = request(chapter, conversation)
    preview = generation.preview(novel.id, data)
    assert preview.discussion_outlines[0].document.text == "寻找寄信人"
    assert preview.plans == []
    assert any("较早讨论未纳入" in item for item in preview.notices)
    assert any("未纳入，以保留完整选定细纲" in item for item in preview.notices)
    frozen = generation.create(novel.id, data)
    with workspace.session() as session:
        context = session.get(Job, frozen.id).context
        assert context["input"]["past_discussions_not_facts"] == []
        assert context["input"]["chapter_outlines"] == [item.model_dump() for item in preview.discussion_outlines]
        estimate = math.ceil(sum(len(item["content"].encode("utf-8")) for item in context["messages"]) / 2) + 256
        assert estimate == preview.estimated_input_tokens
        assert frozen.context.source_fingerprint == preview.source_fingerprint


def test_restore_rejects_cross_book_discussion_without_switching_workspace(library, generation, workspace, tmp_path):
    novel, chapter, service, conversation = setup(library, workspace)
    execute(generation, novel, request(chapter, conversation))
    other = library.create_novel(dto.NovelInput(title="另一作品"))
    foreign = library.create_chapter(other.id, dto.ChapterInput(title="其他细纲"))
    original_id = workspace.db.workspace_id
    with zipfile.ZipFile(io.BytesIO(backup(workspace))) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        path = tmp_path / "tampered-discussion.db"
        path.write_bytes(archive.read("workspace.db"))
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE planning_conversations SET chapter_ids=? WHERE id=?",
                           (json.dumps([foreign.id]), conversation.id))
        connection.commit()
        raw = connection.serialize()
    manifest["files"]["workspace.db"] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("workspace.db", raw)
    with pytest.raises(DomainError, match="同一作品"):
        restore(workspace, output.getvalue())
    assert workspace.db.workspace_id == original_id
    assert service.get(novel.id, conversation.id).conversation.chapter_ids == [chapter.id]


def test_history_is_ordered_and_does_not_read_job_contexts(library, generation, workspace):
    novel, chapter, service, conversation = setup(library, workspace)
    first = execute(generation, novel, request(chapter, conversation))
    with workspace.session(write=True) as session:
        source = session.get(Job, first.id)
        for turn in range(2, 33):
            session.add(Job(id=f"turn_{turn:03}", novel_id=novel.id, chapter_id=chapter.id,
                provider_id="demo", task="discuss", state="succeeded", instruction=f"问题{turn}",
                idempotency_key=uid("history"), request_hash=uid("hash"),
                base_version_id=chapter.working_version_id, context=source.context, result=source.result,
                conversation_id=conversation.id, conversation_turn=turn, created_at=source.created_at))
    statements = []
    def trace(conn, cursor, statement, parameters, context, many):
        statements.append(statement)
    event.listen(workspace.db.engine, "before_cursor_execute", trace)
    try:
        page = service.get(novel.id, conversation.id)
        rest = service.get(novel.id, conversation.id, page.next_before)
    finally:
        event.remove(workspace.db.engine, "before_cursor_execute", trace)
    assert len(page.items) == 30 and page.items[0].id == "turn_032"
    assert [item.id for item in rest.items] == ["turn_002", first.id]
    assert rest.next_before is None
    assert not any("jobs.context" in sql for sql in statements)
