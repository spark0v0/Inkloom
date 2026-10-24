import json
import subprocess
import sys
from pathlib import Path


def test_authored_continuity_fixtures_are_repeatable_without_a_model(tmp_path):
    root = Path(__file__).resolve().parents[2]
    output = tmp_path / "report.json"
    run = subprocess.run([sys.executable, "-X", "utf8", str(root / "evals/run_context_eval.py"),
        "--output", str(output)], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert run.returncode == 0, run.stdout + run.stderr
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["passed"] == report["total"] == 8
    assert report["paid_model_calls"] == 0 and not report["model_quality_evaluated"]
    assert any("expected_stale_context_rejected" in case["checks"] for case in report["cases"])
