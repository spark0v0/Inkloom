import io
import zipfile

import pytest

from app import schemas as dto
from app.domain import DomainError, char_count, uid


def save(library, novel, chapter, text):
    return library.save(novel.id, chapter.id, dto.SaveInput(
        base_version_id=chapter.working_version_id, operation_id=uid("save"), text=text))


def test_empty_text_exports_are_rejected_like_zip(library):
    novel = library.create_novel(dto.NovelInput(title="尚未成稿"))
    library.create_chapter(novel.id, dto.ChapterInput(title="只有细纲", goal="未来事件"))
    for markdown in (False, True):
        with pytest.raises(DomainError) as error:
            library.export(novel.id, markdown=markdown)
        assert error.value.code == "NO_EXPORT_CHAPTERS"
    with pytest.raises(DomainError) as error:
        library.export_chapters(novel.id, confirmed=False)
    assert error.value.code == "NO_EXPORT_CHAPTERS"


def test_range_preview_and_all_formats_use_the_same_chapters(library):
    novel = library.create_novel(dto.NovelInput(title="范围作品"))
    first = library.create_chapter(novel.id, dto.ChapterInput(title="第一章 启程"))
    v1 = save(library, novel, first, "船离开了港口。😀")
    library.confirm(novel.id, first.id, dto.CanonInput(version_id=v1.id, operation_id=uid("confirm")))
    second = library.create_chapter(novel.id, dto.ChapterInput(title="第二章:回声"))
    save(library, novel, second, "第二章的工作正文。\n\n他听见了回声。")
    library.create_chapter(novel.id, dto.ChapterInput(title="第三章 空白", goal="不能导出计划"))
    preview = library.export_preview(novel.id, confirmed=False, start_position=2, end_position=3)
    assert [c.position for c in preview.chapters] == [2, 3]
    assert [c.included for c in preview.chapters] == [True, False]
    assert preview.chapters[1].excluded_reason == "empty"
    assert preview.included_count == 1 and preview.skipped_count == 1
    assert preview.total_chars == char_count("第二章的工作正文。\n\n他听见了回声。")
    options = dict(confirmed=False, start_position=2, end_position=3,
                   expected_fingerprint=preview.fingerprint)
    for markdown in (False, True):
        text = library.export(novel.id, markdown=markdown, **options)
        assert "第二章的工作正文" in text
        assert "港口" not in text and "第三章" not in text and "不能导出计划" not in text
    with zipfile.ZipFile(io.BytesIO(library.export_chapters(novel.id, **options))) as archive:
        assert archive.namelist() == ["0002_第二章_回声.txt"]
        assert "第二章的工作正文" in archive.read(archive.namelist()[0]).decode("utf-8")
    accepted = library.export_preview(novel.id)
    assert accepted.included_count == 1
    assert accepted.chapters[1].excluded_reason == "unconfirmed"


def test_changed_manuscript_requires_fresh_preview(library):
    novel = library.create_novel(dto.NovelInput(title="修改前"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="第一章"))
    version = save(library, novel, chapter, "定稿前的文本。")
    library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id, operation_id=uid("confirm")))
    old = library.export_preview(novel.id)
    save(library, novel, library.chapter(novel.id, chapter.id), "作者修改后的文本。")
    for export in (library.export, library.export_chapters):
        with pytest.raises(DomainError) as error:
            export(novel.id, confirmed=True, expected_fingerprint=old.fingerprint)
        assert (error.value.code, error.value.status) == ("EXPORT_CHANGED", 409)
    current = library.export_preview(novel.id)
    assert current.included_count == 0
    assert current.chapters[0].excluded_reason == "needs_review"
    working = library.export_preview(novel.id, confirmed=False)
    text = library.export(novel.id, expected_fingerprint=working.fingerprint)
    assert "作者修改后的文本" in text and "定稿前的文本" not in text


def test_preview_is_bound_to_book_range_and_titles(library):
    novel = library.create_novel(dto.NovelInput(title="本书"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="第一章"))
    save(library, novel, chapter, "指定范围的正文。")
    preview = library.export_preview(novel.id, confirmed=False, start_position=1, end_position=1)
    library.create_chapter(novel.id, dto.ChapterInput(title="范围之外"))
    text = library.export(novel.id, start_position=1, end_position=1,
                          expected_fingerprint=preview.fingerprint)
    assert "指定范围的正文" in text
    with pytest.raises(DomainError) as error:
        library.export(novel.id, expected_fingerprint=preview.fingerprint)
    assert error.value.code == "EXPORT_CHANGED"
    chapter = library.chapter(novel.id, chapter.id)
    library.edit_chapter(novel.id, chapter.id, dto.ChapterPatch(title="改过的标题"))
    with pytest.raises(DomainError) as error:
        library.export(novel.id, start_position=1, end_position=1,
                       expected_fingerprint=preview.fingerprint)
    assert error.value.code == "EXPORT_CHANGED"
    other = library.create_novel(dto.NovelInput(title="另一本"))
    with pytest.raises(DomainError) as error:
        library.export(other.id, expected_fingerprint=preview.fingerprint)
    assert error.value.code == "EXPORT_CHANGED"


def test_http_export_preview_validation_and_conflict(client):
    novel = client.post('/api/v1/novels', json={'title': '接口导出'}).json()
    base = '/api/v1/novels/' + novel['id']
    chapter = client.post(base + '/chapters', json={'title': '第一章'}).json()
    client.post(base + '/chapters/' + chapter['id'] + '/versions', json={
        'base_version_id': chapter['working_version_id'], 'operation_id': 'export-save', 'text': '真实临时 SQLite 中的正文。'})
    response = client.get(base + '/export-preview?confirmed=false&start_position=1&end_position=1')
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview['included_count'] == 1 and preview['confirmed'] is False
    assert 'text' not in preview['chapters'][0] and 'editor_doc' not in preview['chapters'][0]
    params = dict(confirmed=False, start_position=1, end_position=1,
                  expected_fingerprint=preview['fingerprint'])
    assert client.get(base + '/export', params=params).status_code == 200
    assert client.get(base + '/export', params={**params, 'confirmed': True}).status_code == 409
    assert client.get(base + '/export-preview?start_position=0').status_code == 422
    assert client.get(base + '/export-preview?start_position=2&end_position=1').status_code == 400
    assert client.get('/api/v1/novels/missing/export-preview').status_code == 404
