"""One registry for structured output validation and provider JSON requests."""
from . import schemas as dto

RESULT_SCHEMAS = {
    "extract": dto.ExtractResult, "review": dto.ReviewResult,
    "plan": dto.PlanResult, "handoff": dto.HandoffResult,
    "blueprint": dto.BlueprintResult, "outline": dto.OutlineResult,
    "inspiration": dto.InspirationResult, "outline_edit": dto.OutlineEditResult,
    "discuss": dto.DiscussionResult,
}
