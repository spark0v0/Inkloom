"""Bounded lexical retrieval over eligible canon, including natural Chinese phrases."""
import math
import re
import unicodedata
from dataclasses import dataclass

from sqlalchemy import bindparam, case, func, text


@dataclass(frozen=True)
class SearchTerm:
    text: str
    weight: float


CANON_SCOPE = (" FROM story_search JOIN chapters ON chapters.id=story_search.chapter_id "
               "AND chapters.accepted_version_id=story_search.version_id "
               "WHERE story_search.novel_id=:nid AND chapters.novel_id=:nid "
               "AND chapters.review_state='confirmed' AND chapters.position<:position")


def _spread(values: list[str], count: int) -> list[str]:
    """Sample the whole instruction instead of always discarding its ending."""
    if count <= 0:
        return []
    if len(values) <= count:
        return values
    if count == 1:
        return values[:1]
    return [values[i * (len(values) - 1) // (count - 1)] for i in range(count)]


def retrieval_terms(query: str, names: list[str], limit: int = 64) -> tuple[list[SearchTerm], bool]:
    def normalize(value):
        return unicodedata.normalize("NFKC", value).casefold()

    names = list(dict.fromkeys(normalize(name) for name in names if len(name) >= 2))
    query = normalize(query)
    words = list(dict.fromkeys(word for word in re.findall(r"\w+", query) if 2 <= len(word) <= 32))
    grams = {}
    for phrase in re.findall(r"[\u3400-\u9fff]+", query):
        for start in range(len(phrase) - 1):
            for size in (3, 2):
                value = phrase[start:start + size]
                if len(value) == size:
                    grams[value] = size - 1
    weights = {**grams, **dict.fromkeys(words, 4), **dict.fromkeys(names, 8)}
    # Leave space for Chinese fragments even when many names or fields are present.
    selected = names[:min(32, limit)]
    selected += _spread([word for word in words if word not in selected], min(16, limit - len(selected)))
    selected += _spread([gram for gram in grams if gram not in selected], limit - len(selected))
    return [SearchTerm(value, weights[value]) for value in selected], len(selected) < len(weights)


def match_score(column, terms: list[SearchTerm]):
    """A deterministic lexical score, not a literary or semantic quality score."""
    return sum((case((func.instr(func.lower(column), term.text) > 0, term.weight), else_=0)
                for term in terms), 0)


def weight_terms(session, novel_id: str, position: int, terms: list[SearchTerm]) -> list[SearchTerm]:
    if not terms:
        return []
    # One scoped scan, not one full scan per Chinese bigram. Common fragments such as
    # “主角” must not crowd a unique clue out of the candidate LIMIT before ranking.
    counts = ",".join(f"sum(CASE WHEN instr(lower(story_search.body),:term{i})>0 THEN 1 ELSE 0 END)"
                      for i in range(len(terms)))
    row = session.execute(text("SELECT count(*)," + counts + CANON_SCOPE),
        {"nid": novel_id, "position": position,
         **{f"term{i}": term.text for i, term in enumerate(terms)}}).one()
    documents = row[0]
    return [SearchTerm(term.text, term.weight * math.log1p((documents - (frequency or 0) + .5)
            / ((frequency or 0) + .5))) for term, frequency in zip(terms, row[1:], strict=True)]


def retrieve_source_ids(session, novel_id: str, position: int, terms: list[SearchTerm],
                        excluded: list[str], limit: int = 30) -> list[str]:
    if not terms:
        return []
    params = {"nid": novel_id, "position": position, "limit": limit * 2,
              **{f"term{i}": term.text for i, term in enumerate(terms)}}
    score = " + ".join(f"CASE WHEN instr(lower(story_search.body),:term{i})>0 THEN {term.weight} ELSE 0 END"
                       for i, term in enumerate(terms))
    candidates = {}
    long = [term for term in terms if len(term.text) >= 3]
    short = [i for i, term in enumerate(terms) if len(term.text) == 2]
    predicates = []
    if long:
        params["match"] = " OR ".join('"' + term.text.replace('"', '""') + '"' for term in long)
        predicates.append("story_search MATCH :match")
    if short:
        predicates.append("(" + " OR ".join(f"instr(lower(story_search.body),:term{i})>0" for i in short) + ")")
    for predicate in predicates:
        query = ("SELECT story_search.version_id,story_search.paragraph_id,chapters.position,(" + score
                 + ") AS score" + CANON_SCOPE + " AND " + predicate)
        if excluded:
            query += " AND (story_search.version_id || ':' || story_search.paragraph_id) NOT IN :excluded"
        query += " ORDER BY score DESC,chapters.position DESC,story_search.paragraph_id LIMIT :limit"
        statement = text(query)
        if excluded:
            statement = statement.bindparams(bindparam("excluded", expanding=True))
        for version_id, paragraph_id, chapter_position, rank in session.execute(statement,
                {**params, "excluded": excluded}):
            candidates[f"{version_id}:{paragraph_id}"] = (rank, chapter_position)
    return sorted(candidates, key=lambda key: (-candidates[key][0], -candidates[key][1], key))[:limit]
