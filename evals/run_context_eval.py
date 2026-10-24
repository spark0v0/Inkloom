"""Run authored continuity fixtures in fresh SQLite workspaces, without any model call."""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from app import schemas as dto
from app.context import build_context
from app.domain import DomainError, uid
from app.jobs import Generation
from app.library import Library
from app.references import ChapterReferences
from app.storage import Workspace

ROOT = Path(__file__).resolve().parents[1]


def write_chapter(library, novel_id, title, text):
    chapter = library.create_chapter(novel_id, dto.ChapterInput(title=title))
    version = library.save(novel_id, chapter.id, dto.SaveInput(base_version_id=chapter.working_version_id,
        operation_id=uid("eval-save"), text=text))
    library.confirm(novel_id, chapter.id, dto.CanonInput(version_id=version.id, operation_id=uid("eval-confirm")))
    return library.chapter(novel_id, chapter.id), version


def evaluate_case(case, directory):
    ws = Workspace(directory)
    checks = []
    try:
        library = Library(ws)
        Generation(ws)  # Initialize only the local Demo configuration, never execute it.
        novel = library.create_novel(dto.NovelInput(title="连续性样例：" + case["id"]))
        entity = library.put_entity(novel.id, dto.EntityInput(kind="character", **case["entity"])) if case.get("entity") else None
        for i in range(case.get("filler_entities", 0)):
            library.put_entity(novel.id, dto.EntityInput(kind="character", name=f"路人{i}"))
        old, version = write_chapter(library, novel.id, "较早的约定", case["old_text"])
        write_chapter(library, novel.id, "中间一", "商队经过河谷。")
        write_chapter(library, novel.id, "中间二", "他们在客栈休息。")
        current, _ = write_chapter(library, novel.id, "当前章", "旅人尚未找到答案。")
        library.edit_chapter(novel.id, current.id, dto.ChapterPatch(goal=case["goal"]))
        if case.get("future_text"):
            write_chapter(library, novel.id, "未来章", case["future_text"])
        if case.get("foreign_text"):
            other = library.create_novel(dto.NovelInput(title="隔离样例"))
            write_chapter(library, other.id, "异书", case["foreign_text"])
        selected = dto.ReferenceSelection(
            entity_ids=[entity.id] if case.get("pin_entity") else [],
            chapters=[dto.ChapterReferenceVersion(chapter_id=old.id, version_id=version.id)] if case.get("pin_old") else [],
            notes=case.get("notes", ""))
        ChapterReferences(ws).save(novel.id, current.id, dto.ReferenceUpdate(base_revision=0, selection=selected))
        if case.get("change_old"):
            library.save(novel.id, old.id, dto.SaveInput(base_version_id=version.id,
                operation_id=uid("eval-change"), text=case["change_old"]))
        body = dto.ContextInput(chapter_id=current.id, base_version_id=current.working_version_id, task="review")
        try:
            with ws.session() as session:
                frozen = build_context(session, novel.id, body)
            preview = dto.ContextOut.model_validate(frozen["preview"])
        except DomainError as error:
            assert error.code == case.get("expected_error"), f"unexpected error: {error.code}"
            checks.append("expected_stale_context_rejected")
        else:
            assert not case.get("expected_error"), "expected invalidation was not enforced"
            assert all(source.novel_id == novel.id for source in preview.sources), "cross-book source"
            assert all(source.chapter_position <= current.position for source in preview.sources), "future source"
            checks += ["book_isolation", "narrative_order"]
            if case.get("require_old"):
                assert any(source.version_id == version.id for source in preview.sources), "required old source missing"
                checks.append("required_old_source_present")
            if case.get("pin_entity"):
                assert entity.id in {item.id for item in preview.entities}, "pinned setting missing"
                checks.append("pinned_setting_present")
            if case.get("noncanonical_note"):
                assert frozen["input"]["reference_material"]["status"] == "author_supplied_noncanonical"
                assert case["notes"] not in json.dumps(frozen["input"]["canon_facts"], ensure_ascii=False)
                checks.append("reference_note_separated_from_canon")
        return {"id": case["id"], "description": case["description"], "passed": True, "checks": checks}
    except (AssertionError, DomainError) as error:
        return {"id": case["id"], "passed": False, "error": str(error), "checks": checks}
    finally:
        ws.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New JSON report path; existing reports are not overwritten")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output already exists; choose a new report path")
    fixtures = json.loads((Path(__file__).parent / "continuity-context-v1.json").read_text(encoding="utf-8"))
    temporary = ROOT / ".tmp"
    temporary.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="context-eval-", dir=temporary) as directory:
        cases = [evaluate_case(case, Path(directory) / case["id"]) for case in fixtures["cases"]]
    report = {"fixture_version": fixtures["version"], "model_quality_evaluated": False,
              "paid_model_calls": 0, "passed": sum(case["passed"] for case in cases), "total": len(cases), "cases": cases}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Context engineering fixtures: {report['passed']}/{report['total']} passed; model quality not evaluated")
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
