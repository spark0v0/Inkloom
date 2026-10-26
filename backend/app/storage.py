"""Short SQLite transactions, explicit migrations and independently protected secrets."""

from __future__ import annotations

import base64
import ctypes
import json
import os
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any

from alembic.config import Config
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from alembic import command

from .domain import DomainError, uid

expected_workspace: ContextVar[str | None] = ContextVar("expected_workspace", default=None)

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent


class SecretStore:
    """DPAPI on Windows; explicit master key or session-only on other platforms.

    Neither ciphertext nor master credentials are included in workspace backups.
    """
    def __init__(self, root: Path):
        self.path = root / "secrets.json"
        self.memory: dict[str, str] = {}
        self.lock = threading.RLock()
        self.master = os.environ.get("STORY_WORKSHOP_SECRET_KEY", "")
        self.persistent = os.name == "nt" or bool(self.master)

    def _crypt(self, value: bytes, decrypt: bool = False) -> bytes:
        if os.name != "nt":
            if not self.master:
                raise DomainError("SECRET_SESSION_ONLY", "当前平台的密钥仅保存在本次会话中。")
            cipher = Fernet(self.master.encode())
            return cipher.decrypt(value) if decrypt else cipher.encrypt(value)
        from ctypes import wintypes

        class Blob(ctypes.Structure):
            _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

        buffer = ctypes.create_string_buffer(value)
        inp = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
        out = Blob()
        crypt = ctypes.windll.crypt32
        if decrypt:
            ok = crypt.CryptUnprotectData(ctypes.byref(inp), None, None, None, None, 1,
                                         ctypes.byref(out))
        else:
            ok = crypt.CryptProtectData(ctypes.byref(inp), "Story Workshop", None, None, None, 1,
                                       ctypes.byref(out))
        if not ok:
            raise DomainError("SECRET_UNAVAILABLE", "系统无法保护或读取此密钥，请重新配置。")
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(out.pbData)

    def _read(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            raise DomainError("SECRET_STORE_ERROR", "密钥存储无法读取，请检查工作区权限。") from exc

    def set(self, key: str, value: str | None) -> None:
        with self.lock:
            if not self.persistent:
                if value:
                    self.memory[key] = value
                else:
                    self.memory.pop(key, None)
                return
            data = self._read()
            if value:
                data[key] = base64.b64encode(self._crypt(value.encode())).decode()
            else:
                data.pop(key, None)
            temporary = self.path.with_suffix(".writing")
            temporary.write_text(json.dumps(data), encoding="utf-8")
            if os.name != "nt":
                temporary.chmod(0o600)
            temporary.replace(self.path)

    def get(self, key: str, env_name: str = "") -> str:
        with self.lock:
            if env_name:
                return os.environ.get(env_name, "")
            if not self.persistent:
                return self.memory.get(key, "")
            value = self._read().get(key)
            if not value:
                return ""
            try:
                return self._crypt(base64.b64decode(value), decrypt=True).decode()
            except Exception as exc:
                raise DomainError("SECRET_UNAVAILABLE", "此密钥属于其他系统会话，请重新配置。") from exc

    def has(self, key: str, env_name: str = "") -> bool:
        try:
            return bool(self.get(key, env_name))
        except DomainError:
            return False


class Database:
    def __init__(self, root: Path, migrate: bool = True):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "workspace.db"
        self.lock = threading.RLock()
        self.engine = create_engine("sqlite:///" + self.path.as_posix(),
                                    connect_args={"check_same_thread": False, "timeout": 10})

        @event.listens_for(self.engine, "connect")
        def configure(connection: Any, _: Any) -> None:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=10000")
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")

        if migrate:
            config = Config(str(BACKEND_DIR / "alembic.ini"))
            config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
            with self.engine.begin() as connection:
                config.attributes["connection"] = connection
                command.upgrade(config, "head")
        self.secrets = SecretStore(self.root)
        identity_path = self.root / "workspace-id.json"
        if identity_path.exists():
            self.workspace_id = json.loads(identity_path.read_text(encoding="utf-8"))["id"]
        else:
            self.workspace_id = uid("workspace")
            identity_path.write_text(json.dumps({"id": self.workspace_id}), encoding="utf-8")

    @contextmanager
    def session(self, write: bool = False):
        with self.lock, Session(self.engine, expire_on_commit=False) as session:
            try:
                if write:
                    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
                yield session
                if write:
                    session.commit()
            except BaseException:
                session.rollback()
                raise


class Workspace:
    def __init__(self, root: Path):
        self.home = root.resolve()
        self.home.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.pointer = self.home / "active-workspace.json"
        self.restores: dict[str, Path] = {}
        active = self.home
        if self.pointer.exists():
            candidate = Path(json.loads(self.pointer.read_text(encoding="utf-8"))["path"]).resolve()
            if candidate.is_relative_to(self.home / "restored") and candidate.is_dir():
                active = candidate
        self.db = Database(active)

    def ensure_current(self):
        expected = expected_workspace.get()
        if expected is not None and expected != self.db.workspace_id:
            raise DomainError("WORKSPACE_CHANGED", "工作区已在其他页面切换，请重新载入。原页面的修改未写入当前工作区。", 409)

    @contextmanager
    def session(self, write: bool = False):
        with self.lock:
            self.ensure_current()
            with self.db.session(write=write) as session:
                yield session

    def activate(self, root: Path) -> None:
        with self.lock:
            resolved = root.resolve()
            if resolved != self.home and not resolved.is_relative_to(self.home / "restored"):
                raise DomainError("RESTORE_PATH_INVALID", "恢复目录不属于此工作区。")
            replacement = Database(resolved)
            temporary = self.pointer.with_suffix(".writing")
            temporary.write_text(json.dumps({"path": str(resolved)}), encoding="utf-8")
            temporary.replace(self.pointer)
            old = self.db
            self.db = replacement
            old.engine.dispose()

    def close(self) -> None:
        """Release pooled Windows handles before shutdown or temporary-workspace cleanup."""
        with self.lock:
            self.db.engine.dispose()
