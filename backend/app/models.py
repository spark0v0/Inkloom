"""Versioned SQLite schema; domain operations live in services, not ORM callbacks."""

from __future__ import annotations

from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .domain import now


class Base(DeclarativeBase):
    pass


class Novel(Base):
    __tablename__ = "novels"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    genre: Mapped[str] = mapped_column(String(80), default="")
    premise: Mapped[str] = mapped_column(Text, default="")
    style: Mapped[str] = mapped_column(Text, default="")
    platform: Mapped[str] = mapped_column(String(40), default="番茄小说")
    target_words: Mapped[int] = mapped_column(Integer, default=1000000)
    chapter_words: Mapped[int] = mapped_column(Integer, default=2000)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    settings_revision: Mapped[int] = mapped_column(Integer, default=1)
    canon_revision: Mapped[int] = mapped_column(Integer, default=0)
    dirty_from_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class Chapter(Base):
    __tablename__ = "chapters"
    __table_args__ = (UniqueConstraint("novel_id", "position"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    novel_id: Mapped[str] = mapped_column(ForeignKey("novels.id"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    volume: Mapped[str] = mapped_column(String(160), default="第一卷")
    position: Mapped[int] = mapped_column(Integer)
    goal: Mapped[str] = mapped_column(Text, default="")
    references: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    references_revision: Mapped[int] = mapped_column(Integer, default=0)
    working_version_id: Mapped[str] = mapped_column(String)
    accepted_version_id: Mapped[str | None] = mapped_column(String, nullable=True)
    review_state: Mapped[str] = mapped_column(String, default="draft")
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class Version(Base):
    __tablename__ = "versions"
    __table_args__ = (UniqueConstraint("chapter_id", "operation_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id"), index=True)
    parent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    operation_id: Mapped[str] = mapped_column(String)
    request_hash: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    editor_doc: Mapped[dict[str, Any]] = mapped_column(JSON)
    paragraphs: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String)
    char_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Entity(Base):
    __tablename__ = "entities"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    novel_id: Mapped[str] = mapped_column(ForeignKey("novels.id"), index=True)
    kind: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String(160))
    summary: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="author")
    updated_at: Mapped[str] = mapped_column(String, default=now)


class ThreadTrack(Base):
    __tablename__ = "thread_tracks"
    entity_id: Mapped[str] = mapped_column(ForeignKey("entities.id"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    target_chapter_id: Mapped[str | None] = mapped_column(ForeignKey("chapters.id"), nullable=True)
    intent: Mapped[str] = mapped_column(Text, default="")
    paused: Mapped[bool] = mapped_column(Boolean, default=False)


class ThreadProgress(Base):
    __tablename__ = "thread_progress"
    __table_args__ = (UniqueConstraint("entity_id", "operation_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey("thread_tracks.entity_id"), index=True)
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id"))
    version_id: Mapped[str] = mapped_column(ForeignKey("versions.id"))
    stage: Mapped[str] = mapped_column(String)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON)
    note: Mapped[str] = mapped_column(Text, default="")
    voided: Mapped[bool] = mapped_column(Boolean, default=False)
    operation_id: Mapped[str] = mapped_column(String)
    request_hash: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    novel_id: Mapped[str] = mapped_column(ForeignKey("novels.id"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    level: Mapped[str] = mapped_column(String, default="chapter")
    body: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int] = mapped_column(Integer, default=1)
    parent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    structure: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class Fact(Base):
    __tablename__ = "facts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    novel_id: Mapped[str] = mapped_column(ForeignKey("novels.id"), index=True)
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id"), index=True)
    version_id: Mapped[str] = mapped_column(ForeignKey("versions.id"))
    canon_revision: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String)
    subject: Mapped[str] = mapped_column(String(160), default="")
    claim: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    story_time: Mapped[str | None] = mapped_column(String, nullable=True)
    known_by: Mapped[list[str]] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String, default=now)


class CanonRevision(Base):
    __tablename__ = "canon_revisions"
    __table_args__ = (UniqueConstraint("novel_id", "revision"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    novel_id: Mapped[str] = mapped_column(ForeignKey("novels.id"))
    revision: Mapped[int] = mapped_column(Integer)
    operation_id: Mapped[str] = mapped_column(String, unique=True)
    request_hash: Mapped[str] = mapped_column(String)
    accepted_mapping: Mapped[dict[str, str]] = mapped_column(JSON)
    changes: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Provider(Base):
    __tablename__ = "providers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String, default="openai_compatible")
    base_url: Mapped[str] = mapped_column(String, default="")
    model: Mapped[str] = mapped_column(String, default="")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    stream: Mapped[bool] = mapped_column(Boolean, default=True)
    include_usage: Mapped[bool] = mapped_column(Boolean, default=True)
    json_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    token_parameter: Mapped[str] = mapped_column(String, default="max_tokens")
    context_window: Mapped[int] = mapped_column(Integer, default=16000)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=2000)
    input_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String, default="CNY")
    price_date: Mapped[str | None] = mapped_column(String, nullable=True)
    key_env: Mapped[str] = mapped_column(String, default="")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("novel_id", "idempotency_key"),
        Index("one_active_job_per_novel", "novel_id", unique=True,
              sqlite_where=text("state IN ('queued','running','pausing','cancelling')")),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    novel_id: Mapped[str] = mapped_column(ForeignKey("novels.id"), index=True)
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id"))
    task: Mapped[str] = mapped_column(String)
    instruction: Mapped[str] = mapped_column(Text)
    provider_id: Mapped[str] = mapped_column(ForeignKey("providers.id"))
    state: Mapped[str] = mapped_column(String, default="queued", index=True)
    idempotency_key: Mapped[str] = mapped_column(String)
    request_hash: Mapped[str] = mapped_column(String)
    base_version_id: Mapped[str] = mapped_column(String)
    context: Mapped[dict[str, Any]] = mapped_column(JSON)
    selection: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    output_text: Mapped[str] = mapped_column(Text, default="")
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    candidate_status: Mapped[str] = mapped_column(String, default="partial")
    adopted_version_id: Mapped[str | None] = mapped_column(String, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    max_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    reserved_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(String, nullable=True)
    lease_epoch: Mapped[int] = mapped_column(Integer, default=0)
    lease_until: Mapped[float | None] = mapped_column(Float, nullable=True)
    checkpoint: Mapped[str] = mapped_column(String, default="prepared")
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class Attempt(Base):
    __tablename__ = "attempts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    call_state: Mapped[str] = mapped_column(String, default="request_prepared")
    output_text: Mapped[str] = mapped_column(Text, default="")
    usage: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)


class JobEvent(Base):
    __tablename__ = "job_events"
    __table_args__ = (UniqueConstraint("job_id", "seq"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON)
