"""Public v1 contract; frontend declarations are generated from this OpenAPI schema."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True, allow_inf_nan=False)


class WritingPreferences(Schema):
    viewpoint: Literal["unspecified", "first_person", "third_person_limited", "omniscient"] = "unspecified"
    avoid: str = Field(default="", max_length=1200)
    example: str = Field(default="", max_length=4000)


class WritingStyleInput(Schema):
    base_settings_revision: int = Field(ge=0)
    style: str = Field(default="", max_length=8000)
    preferences: WritingPreferences = Field(default_factory=WritingPreferences)


class NovelInput(Schema):
    title: str = Field(min_length=1, max_length=160)
    genre: str = Field(default="", max_length=80)
    premise: str = Field(default="", max_length=12000)
    style: str = Field(default="", max_length=8000)
    platform: str = Field(default="番茄小说", max_length=40)
    target_words: int = Field(default=1000000, ge=10000, le=10000000)
    chapter_words: int = Field(default=2000, ge=500, le=6000)


class NovelPatch(Schema):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    genre: str | None = Field(default=None, max_length=80)
    premise: str | None = Field(default=None, max_length=12000)
    style: str | None = Field(default=None, max_length=8000)
    archived: bool | None = None
    platform: str | None = Field(default=None, max_length=40)
    target_words: int | None = Field(default=None, ge=10000, le=10000000)
    chapter_words: int | None = Field(default=None, ge=500, le=6000)


class NovelOut(Schema):
    id: str
    title: str
    genre: str
    premise: str
    style: str
    writing_preferences: WritingPreferences = Field(default_factory=WritingPreferences)
    platform: str
    target_words: int
    chapter_words: int
    is_demo: bool
    archived: bool
    settings_revision: int
    canon_revision: int
    dirty_from_order: int | None
    chapter_count: int
    accepted_count: int
    total_chars: int
    created_at: str
    updated_at: str


class ParagraphOut(Schema):
    paragraph_id: str
    ordinal: int
    text: str


class VersionOut(Schema):
    id: str
    chapter_id: str
    parent_id: str | None
    text: str
    editor_doc: dict[str, Any]
    paragraphs: list[ParagraphOut]
    content_hash: str
    char_count: int
    created_at: str


class VersionSummary(Schema):
    id: str
    parent_id: str | None
    char_count: int
    content_hash: str
    created_at: str


class ChapterInput(Schema):
    title: str = Field(default="新章节", min_length=1, max_length=240)
    volume: str = Field(default="第一卷", max_length=160)
    goal: str = Field(default="", max_length=8000)


class ChapterPatch(Schema):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    volume: str | None = Field(default=None, max_length=160)
    goal: str | None = Field(default=None, max_length=8000)


class ChapterSummary(Schema):
    id: str
    novel_id: str
    title: str
    volume: str
    position: int
    goal: str
    working_version_id: str
    accepted_version_id: str | None
    review_state: str
    char_count: int
    updated_at: str


class ChapterReferenceVersion(Schema):
    chapter_id: str = Field(min_length=1, max_length=160)
    version_id: str = Field(min_length=1, max_length=160)


class ReferenceSelection(Schema):
    entity_ids: list[Annotated[str, Field(min_length=1, max_length=160)]] = Field(default_factory=list, max_length=40)
    chapters: list[ChapterReferenceVersion] = Field(default_factory=list, max_length=8)
    notes: str = Field(default="", max_length=12000)

    @field_validator("entity_ids", "chapters")
    @classmethod
    def unique_references(cls, values):
        keys = [value if isinstance(value, str) else value.chapter_id for value in values]
        if len(keys) != len(set(keys)):
            raise ValueError("参考项目不能重复。")
        return values


class ReferenceUpdate(Schema):
    base_revision: int = Field(ge=0)
    selection: ReferenceSelection


class ReferenceState(Schema):
    chapter_id: str
    revision: int
    selection: ReferenceSelection


class ChapterOut(ChapterSummary):
    version: VersionOut
    references: ReferenceSelection
    references_revision: int


class SaveInput(Schema):
    base_version_id: str
    operation_id: str = Field(min_length=8, max_length=160)
    text: str = Field(max_length=200000)
    editor_doc: dict[str, Any] | None = None


class EntityInput(Schema):
    kind: Literal["character", "world", "thread", "timeline"]
    name: str = Field(min_length=1, max_length=160)
    summary: str = Field(default="", max_length=4000)
    body: str = Field(default="", max_length=16000)
    aliases: list[str] = Field(default_factory=list, max_length=50)
    status: Literal["author", "proposed"] = "author"


class EntityOut(EntityInput):
    id: str
    novel_id: str
    updated_at: str


class EntityUpdate(EntityInput):
    base_updated_at: str = Field(min_length=1, max_length=60)


class PlanInput(Schema):
    title: str = Field(min_length=1, max_length=240)
    level: Literal["book", "volume", "chapter", "scene"] = "chapter"
    body: str = Field(default="", max_length=24000)


class PlanOut(PlanInput):
    id: str
    novel_id: str
    position: int
    updated_at: str
    parent_id: str | None = None
    structure: dict[str, Any] = Field(default_factory=dict)


class Source(Schema):
    source_id: str
    novel_id: str
    chapter_id: str
    chapter_title: str
    chapter_position: int
    version_id: str
    paragraph_id: str
    content_hash: str
    text: str
    kind: str
    pinned: bool = False


class Evidence(Schema):
    source_id: str
    quote: str = Field(min_length=1, max_length=10000)
    novel_id: str | None = None
    chapter_id: str | None = None
    chapter_title: str | None = None
    chapter_position: int | None = None
    version_id: str | None = None
    paragraph_id: str | None = None
    content_hash: str | None = None
    kind: str | None = None
    start_codepoint: int | None = None
    end_codepoint: int | None = None


ThreadStage = Literal["planted", "advanced", "resolved"]
ThreadStatus = Literal["planned", "planted", "advanced", "resolved", "needs_review"]


class ThreadPlanInput(Schema):
    base_revision: int = Field(ge=0)
    target_chapter_id: str | None = Field(default=None, max_length=160)
    intent: str = Field(default="", max_length=2000)
    paused: bool = False


class ThreadProgressInput(Schema):
    base_revision: int = Field(ge=0)
    operation_id: str = Field(min_length=8, max_length=160)
    chapter_id: str = Field(min_length=1, max_length=160)
    version_id: str = Field(min_length=1, max_length=160)
    stage: ThreadStage
    evidence: Evidence
    note: str = Field(default="", max_length=2000)


class ThreadProgressChange(Schema):
    base_revision: int = Field(ge=0)
    voided: bool


class ThreadProgressOut(Schema):
    id: str
    chapter_id: str
    version_id: str
    chapter_title: str
    chapter_position: int
    paragraph_ordinal: int
    stage: ThreadStage
    evidence: Evidence
    note: str
    voided: bool
    valid: bool
    invalid_reason: str
    created_at: str


class ThreadOut(Schema):
    entity: EntityOut
    revision: int
    target_chapter_id: str | None
    target_chapter_title: str | None
    target_position: int | None
    intent: str
    paused: bool
    status: ThreadStatus
    progress: list[ThreadProgressOut]


class ThreadGuidance(Schema):
    entity_id: str
    name: str
    status: ThreadStatus
    author_plan: str
    target_chapter_title: str | None
    due: bool
    progress: list[ThreadProgressOut]
    omitted_records: int


class MemoryProposal(Schema):
    kind: Literal["event", "state", "knowledge", "thread"] = "event"
    subject: str = Field(default="", max_length=160)
    claim: str = Field(min_length=1, max_length=3000)
    evidence: list[Evidence] = Field(min_length=1, max_length=8)
    story_time: str | None = Field(default=None, max_length=240)
    known_by: list[str] = Field(default_factory=list, max_length=50)


class FactOut(MemoryProposal):
    id: str
    novel_id: str
    chapter_id: str
    version_id: str
    canon_revision: int
    active: bool


class CanonInput(Schema):
    version_id: str
    operation_id: str = Field(min_length=8, max_length=160)
    changes: list[MemoryProposal] = Field(default_factory=list, max_length=100)


class CanonOut(Schema):
    revision: int
    confirmed_chapter_id: str
    dirty_from_order: int | None
    fact_count: int


class ExtractResult(Schema):
    kind: Literal["extract"]
    changes: list[MemoryProposal] = Field(max_length=100)
    uncertainties: list[str] = Field(default_factory=list, max_length=50)


class Finding(Schema):
    type: Literal["fact_conflict", "knowledge_leak", "timeline_question", "motivation_question",
                  "repetition", "pacing", "thread_question", "needs_verification"]
    severity: Literal["important", "question", "suggestion"]
    target: Evidence
    source_evidence: list[Evidence] = Field(default_factory=list, max_length=8)
    explanation: str = Field(max_length=3000)
    suggestion: str = Field(max_length=3000)
    decision: Literal["pending", "confirmed", "intentional", "false_positive", "later"] = "pending"
    decision_note: str = ""


class ReviewResult(Schema):
    kind: Literal["review"]
    findings: list[Finding] = Field(max_length=50)
    summary: str = Field(max_length=5000)


class ScenePlan(Schema):
    goal: str
    obstacle: str
    decision: str
    change: str


class PlanResult(Schema):
    kind: Literal["plan"]
    title: str
    scenes: list[ScenePlan] = Field(min_length=1, max_length=12)
    open_questions: list[str] = Field(default_factory=list)


class HandoffResult(Schema):
    kind: Literal["handoff"]
    observations: list[MemoryProposal] = Field(max_length=30)
    open_questions: list[str] = Field(default_factory=list)
    next_suggestions: list[str] = Field(default_factory=list)


class InspirationOption(Schema):
    title: str = Field(min_length=1, max_length=160)
    event: str = Field(min_length=1, max_length=1600)
    motivation: str = Field(min_length=1, max_length=1200)
    choice: str = Field(min_length=1, max_length=1200)
    cost: str = Field(min_length=1, max_length=1200)
    beats: list[Annotated[str, Field(min_length=1, max_length=600)]] = Field(min_length=2, max_length=4)
    required_setup: list[Annotated[str, Field(min_length=1, max_length=600)]] = Field(default_factory=list, max_length=5)
    evidence: list[Evidence] = Field(default_factory=list, max_length=5)


class InspirationResult(Schema):
    kind: Literal["inspiration"]
    diagnosis: str = Field(min_length=1, max_length=1500)
    options: list[InspirationOption] = Field(min_length=3, max_length=3)


class InspirationReference(Schema):
    job_id: str = Field(min_length=1, max_length=160)
    option_index: int = Field(ge=0, le=2)


class ReviewReference(Schema):
    job_id: str = Field(min_length=1, max_length=160)
    finding_index: int = Field(ge=0, le=49)
    finding_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class BlueprintCharacter(Schema):
    name: str = Field(min_length=1, max_length=160)
    role: str = Field(min_length=1, max_length=240)
    motivation: str = Field(min_length=1, max_length=1200)
    arc: str = Field(min_length=1, max_length=1600)


class BlueprintWorld(Schema):
    name: str = Field(min_length=1, max_length=160)
    rule: str = Field(min_length=1, max_length=3000)


class VolumeBlueprint(Schema):
    title: str = Field(min_length=1, max_length=160)
    summary: str = Field(min_length=1, max_length=3000)
    climax: str = Field(min_length=1, max_length=1200)
    ending_hook: str = Field(min_length=1, max_length=1200)
    planned_chapters: int = Field(ge=3, le=300)


class BlueprintResult(Schema):
    kind: Literal["blueprint"]
    title: str = Field(min_length=1, max_length=160)
    logline: str = Field(min_length=1, max_length=1200)
    blurb: str = Field(min_length=1, max_length=3000)
    reader_promise: str = Field(min_length=1, max_length=3000)
    main_conflict: str = Field(min_length=1, max_length=3000)
    ending: str = Field(min_length=1, max_length=3000)
    style_guide: str = Field(min_length=1, max_length=4000)
    characters: list[BlueprintCharacter] = Field(min_length=1, max_length=12)
    world: list[BlueprintWorld] = Field(min_length=1, max_length=12)
    volumes: list[VolumeBlueprint] = Field(min_length=1, max_length=20)


class ChapterOutline(Schema):
    number: int = Field(ge=1, le=10000)
    title: str = Field(min_length=1, max_length=200)
    goal: str = Field(min_length=1, max_length=1200)
    conflict: str = Field(min_length=1, max_length=1200)
    beats: list[Annotated[str, Field(min_length=1, max_length=600)]] = Field(min_length=1, max_length=6)
    ending_hook: str = Field(min_length=1, max_length=1000)


class OutlineResult(Schema):
    kind: Literal["outline"]
    volume_title: str = Field(min_length=1, max_length=160)
    chapters: list[ChapterOutline] = Field(min_length=3, max_length=20)


class ProductionApplyOut(Schema):
    novel_id: str
    chapter_ids: list[str]
    plan_ids: list[str]


TaskResult = ExtractResult | ReviewResult | PlanResult | HandoffResult | BlueprintResult | OutlineResult | InspirationResult

TaskName = Literal["continue", "rewrite", "plan", "extract", "review", "handoff", "blueprint", "outline", "inspiration"]


class Selection(Schema):
    start_codepoint: int = Field(ge=0)
    end_codepoint: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=200000)


class ReviewRewriteInput(Schema):
    base_version_id: str = Field(min_length=1, max_length=160)
    index: int = Field(ge=0, le=49)


class ReviewRewritePreparation(Schema):
    base_version_id: str
    reference: ReviewReference
    selection: Selection
    finding: Finding
    suggested_target_chars: int = Field(ge=100, le=6000)


class ContextInput(Schema):
    chapter_id: str
    base_version_id: str
    references_revision: int | None = Field(default=None, ge=0)
    task: TaskName
    instruction: str = Field(default="", max_length=12000)
    provider_id: str = "demo"
    excluded_source_ids: list[str] = Field(default_factory=list, max_length=500)
    selection: Selection | None = None
    target_chars: int = Field(default=500, ge=100, le=6000)
    volume_plan_id: str | None = None
    chapter_batch: int = Field(default=5, ge=3, le=20)
    inspiration: InspirationReference | None = None
    review_reference: ReviewReference | None = None


class ContextOut(Schema):
    writing_preferences: WritingPreferences | None = None
    thread_guidance: list[ThreadGuidance] = Field(default_factory=list)
    novel_id: str
    chapter_id: str
    base_version_id: str
    task: str
    canon_revision: int
    settings_revision: int
    references_revision: int = 0
    pinned_entity_ids: list[str] = Field(default_factory=list)
    pinned_chapters: list[ChapterReferenceVersion] = Field(default_factory=list)
    reference_notes: str = ""
    target_chars: int | None = None
    author_brief: dict[str, str] = Field(default_factory=dict)
    chapter_goal: str = ""
    instruction: str = ""
    current_selection: Selection | None = None
    rewrite_surroundings: dict[str, str] = Field(default_factory=dict)
    sources: list[Source]
    entities: list[EntityOut]
    facts: list[FactOut]
    plans: list[PlanOut]
    estimated_input_tokens: int
    max_output_tokens: int
    context_window: int
    estimate_note: str
    notices: list[str]
    excluded_source_ids: list[str]
    source_fingerprint: str
    estimated_max_cost: float | None
    currency: str
    provider_name: str
    model: str
    is_demo: bool
    provider_url: str = ""
    inspiration_title: str | None = None
    inspiration_reference: InspirationReference | None = None
    review_reference: ReviewReference | None = None
    review_explanation: str | None = None
    review_suggestion: str | None = None


class JobInput(ContextInput):
    idempotency_key: str = Field(min_length=8, max_length=160)
    max_attempts: int = Field(default=3, ge=1, le=5)
    max_cost: float | None = Field(default=None, gt=0, le=10000)


class AttemptOut(Schema):
    id: str
    number: int
    call_state: str
    output_text: str
    usage: dict[str, Any] | None
    cost: float | None
    error_code: str | None
    created_at: str
    finished_at: str | None


class JobOut(Schema):
    id: str
    novel_id: str
    chapter_id: str
    task: str
    instruction: str
    provider_id: str
    state: str
    base_version_id: str
    output_text: str
    result: TaskResult | None
    candidate_status: str
    adopted_version_id: str | None
    attempt_count: int
    max_attempts: int
    max_cost: float | None
    reserved_cost: float | None
    cost: float | None
    checkpoint: str
    error_code: str | None
    error_message: str | None
    is_demo: bool
    created_at: str
    updated_at: str


class JobDetail(JobOut):
    context: ContextOut
    attempts: list[AttemptOut]


class JobProgress(Schema):
    id: str
    novel_id: str
    state: str
    output_text: str
    candidate_status: str
    attempt_count: int
    cost: float | None
    checkpoint: str
    error_code: str | None
    error_message: str | None
    updated_at: str


JobStateName = Literal["queued", "running", "pausing", "paused", "cancelling", "succeeded", "failed", "cancelled", "interrupted_uncertain"]


class JobHistoryItem(Schema):
    id: str
    novel_id: str
    chapter_id: str
    novel_title: str
    chapter_title: str
    task: str
    state: str
    instruction_preview: str
    candidate_status: str
    attempt_count: int
    max_attempts: int
    is_demo: bool
    created_at: str


class JobHistoryPage(Schema):
    items: list[JobHistoryItem]
    next_cursor: str | None = None


class JobEventOut(Schema):
    seq: int
    kind: str
    data: dict[str, Any]
    created_at: str


class AdoptInput(Schema):
    base_version_id: str


class FindingDecision(Schema):
    index: int = Field(ge=0)
    decision: Literal["pending", "confirmed", "intentional", "false_positive", "later"]
    note: str = Field(default="", max_length=2000)
    base_decision: Literal["pending", "confirmed", "intentional", "false_positive", "later"] | None = None
    base_note: str | None = Field(default=None, max_length=2000)


class ProviderInput(Schema):
    name: str = Field(min_length=1, max_length=120)
    base_url: str = Field(max_length=1000)
    model: str = Field(min_length=1, max_length=160)
    api_key: SecretStr | None = Field(default=None, repr=False)
    clear_key: bool = False
    key_env: str = Field(default="", max_length=160)
    stream: bool = True
    include_usage: bool = True
    json_mode: bool = False
    token_parameter: Literal["max_tokens", "max_completion_tokens"] = "max_tokens"
    context_window: int = Field(default=16000, ge=2048, le=2000000)
    max_output_tokens: int = Field(default=2000, ge=64, le=64000)
    input_price: float | None = Field(default=None, ge=0)
    output_price: float | None = Field(default=None, ge=0)
    currency: Literal["CNY", "USD"] = "CNY"
    price_date: str | None = Field(default=None, max_length=10)

    @field_validator("key_env")
    @classmethod
    def safe_env(cls, value: str) -> str:
        import re
        if value and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,159}", value):
            raise ValueError("环境变量名称无效")
        return value


class ProviderOut(Schema):
    id: str
    name: str
    kind: str
    base_url: str
    model: str
    revision: int
    stream: bool
    include_usage: bool
    json_mode: bool
    token_parameter: str
    context_window: int
    max_output_tokens: int
    input_price: float | None
    output_price: float | None
    currency: str
    price_date: str | None
    key_env: str
    has_key: bool
    secret_persistent: bool


class SearchResult(Schema):
    source: Source
    match_kind: str


class ImportPreviewInput(Schema):
    text: str = Field(max_length=2000000)


class ImportChapter(Schema):
    title: str = Field(min_length=1, max_length=240)
    text: str = Field(max_length=200000)


class ImportInput(Schema):
    title: str = Field(min_length=1, max_length=160)
    chapters: list[ImportChapter] = Field(min_length=1, max_length=1000)


class HealthOut(Schema):
    status: str
    workspace_id: str
    workspace_name: str
    version: str
    is_restored: bool = False


class RestoreOut(Schema):
    restore_id: str
    novel_count: int
    chapter_count: int
    message: str


class ActivateInput(Schema):
    restore_id: str


class ErrorOut(Schema):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class RoleConfig(Schema):
    writer: str = "demo"
    planner: str = "demo"
    extractor: str = "demo"
    reviewer: str = "demo"


class ConnectionOut(Schema):
    reachable: bool
    model_listed: bool
    message: str
    models: list[str] = Field(default_factory=list, max_length=1000)
    models_truncated: bool = False
