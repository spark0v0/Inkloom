"""No lifespan/database side effects: used by the frontend contract generator."""
import json
import sys

from .main import create_app

sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps(create_app(worker=False).openapi(), ensure_ascii=False))
