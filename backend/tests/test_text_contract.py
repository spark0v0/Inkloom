import json
from pathlib import Path

import pytest

from app.domain import DomainError, char_count, document_text

FIXTURES = json.loads((Path(__file__).resolve().parents[2] / "docs/contracts/text-fixtures.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("sample", FIXTURES, ids=[s["label"] for s in FIXTURES])
def test_shared_unicode_contract(sample):
    assert char_count(sample["text"]) == sample["count"]


@pytest.mark.parametrize("document", [[], {"type": "doc", "content": {}},
    {"type": "doc", "content": [{"type": "text", "text": "bad"}]},
    {"type": "doc", "content": [{"type": "paragraph", "content": ["bad"]}]},
    {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x", "marks": [None]}]}]}])
def test_invalid_document_is_domain_error(document):
    with pytest.raises(DomainError):
        document_text(document)
