"""Materialize explicitly accepted AI plans in one transaction, preserving all existing prose."""

from sqlalchemy import func, select

from . import schemas as dto
from .context import validate_result
from .domain import DomainError, digest, now, uid
from .library import new_version, require_novel
from .models import Chapter, Entity, Job, Plan


def apply_production(session, job: Job) -> dto.ProductionApplyOut:
    result = validate_result(job.task, job.result, job.context)
    novel = require_novel(session, job.novel_id)
    plan_ids, chapter_ids = [], []
    position = session.scalar(select(func.max(Plan.position)).where(Plan.novel_id == novel.id)) or 0

    def plan(title, level, body, structure, parent_id=None):
        nonlocal position
        position += 1
        item = Plan(id=uid("plan"), novel_id=novel.id, title=title, level=level,
                    body=body, structure=structure, parent_id=parent_id, position=position)
        session.add(item)
        plan_ids.append(item.id)
        return item

    if job.task == "blueprint":
        if session.scalar(select(Plan.id).where(Plan.novel_id == novel.id, Plan.level == "book")):
            raise DomainError("BLUEPRINT_EXISTS", "已有全书大纲，请编辑现有规划。未覆盖任何内容。", 409)
        if novel.title == "未命名作品":
            novel.title = result["title"]
        root = plan(novel.title, "book", "\n\n".join([result["logline"], result["reader_promise"],
            result["main_conflict"], "结局方向：" + result["ending"]]), {**result, "title": novel.title})
        for volume in result["volumes"]:
            plan(volume["title"], "volume", volume["summary"] + "\n\n高潮：" + volume["climax"]
                 + "\n卷末：" + volume["ending_hook"], volume, root.id)
        names = {(e.kind, e.name) for e in session.scalars(select(Entity).where(Entity.novel_id == novel.id)).all()}
        for character in result["characters"]:
            if ("character", character["name"]) not in names:
                session.add(Entity(id=uid("entity"), novel_id=novel.id, kind="character",
                    name=character["name"], summary=character["role"],
                    body="动机：" + character["motivation"] + "\n人物弧线：" + character["arc"], status="author"))
                names.add(("character", character["name"]))
        for rule in result["world"]:
            if ("world", rule["name"]) not in names:
                session.add(Entity(id=uid("entity"), novel_id=novel.id, kind="world",
                    name=rule["name"], summary=rule["rule"], body=rule["rule"], status="author"))
                names.add(("world", rule["name"]))
        if not novel.style:
            novel.style = result["style_guide"]
    else:
        production = job.context["input"]["production"]
        parent = session.get(Plan, production["volume_plan_id"])
        if parent is None or parent.novel_id != novel.id or parent.level != "volume":
            raise DomainError("VOLUME_NOT_FOUND", "分卷已变化，未创建章节。", 409)
        for index, outline in enumerate(result["chapters"]):
            title = f"第{outline['number']}章 {outline['title']}"
            goal = (outline["goal"] + "\n冲突：" + outline["conflict"] + "\n情节：\n"
                    + "\n".join(outline["beats"]) + "\n章末：" + outline["ending_hook"])
            if index == 0 and production.get("initial_slot"):
                chapter = session.get(Chapter, production["initial_slot"])
                chapter.title, chapter.volume, chapter.goal = title, parent.title, goal
                chapter.updated_at = now()
            else:
                chapter = Chapter(id=uid("chapter"), novel_id=novel.id, title=title,
                    volume=parent.title, goal=goal, position=outline["number"], working_version_id="")
                session.add(chapter)
                session.flush()
                new_version(session, chapter, "", "outline:" + job.id, digest(""))
            chapter_ids.append(chapter.id)
            plan(title, "chapter", goal, {**outline, "kind": "chapter_outline", "chapter_id": chapter.id}, parent.id)
    novel.settings_revision += 1
    novel.updated_at = now()
    applied = dto.ProductionApplyOut(novel_id=novel.id, chapter_ids=chapter_ids, plan_ids=plan_ids)
    job.context = {**job.context, "applied": applied.model_dump()}
    job.candidate_status = "adopted"
    session.flush()
    return applied
