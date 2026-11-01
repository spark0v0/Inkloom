import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, errorText } from '../lib/api'
import type { ImportChapter, Novel } from '../lib/api'
import { Button, Field, Modal, Notice } from '../components/ui'

type Phase = 'read' | 'preview' | 'import' | null

export function ImportModal({ open, onClose, onImported }: {
  open: boolean
  onClose: () => void
  onImported: (novel: Novel) => Promise<void>
}) {
  const cache = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [encoding, setEncoding] = useState('utf-8')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [chapters, setChapters] = useState<ImportChapter[]>([])
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<Phase>(null)
  const [imported, setImported] = useState<Novel | null>(null)
  const pending = useRef(false)
  const composing = useRef(false)
  const alive = useRef(true)
  const readSequence = useRef(0)
  const busy = phase !== null

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; readSequence.current += 1 }
  }, [])

  function begin(next: Phase) {
    if (pending.current || composing.current) return false
    pending.current = true
    setPhase(next); setError('')
    return true
  }

  function finish() {
    pending.current = false
    if (alive.current) setPhase(null)
  }

  async function decode(selectedFile: File, code: string) {
    if (!begin('read')) return
    const sequence = ++readSequence.current
    setText(''); setChapters([]); setSelected(0)
    try {
      if (selectedFile.size > 6_000_000) throw new Error('手稿超过 6 MB，请分卷导入。')
      let body: string
      try {
        body = new TextDecoder(code, { fatal: true }).decode(await selectedFile.arrayBuffer())
      } catch {
        throw new Error('文件无法按所选编码读取，请切换编码后检查预览，或使用 UTF-8 文件。')
      }
      if (!alive.current || sequence !== readSequence.current) return
      setText(body)
      setTitle(previous => previous || selectedFile.name.replace(/\.(txt|md|markdown)$/i, ''))
    } catch (e) {
      if (alive.current && sequence === readSequence.current) setError(errorText(e))
    } finally { finish() }
  }

  async function preview() {
    if (!text.trim() || !begin('preview')) return
    try {
      const value = await api.importPreview(text)
      if (alive.current) { setChapters(value); setSelected(0) }
    } catch (e) { if (alive.current) setError(errorText(e)) }
    finally { finish() }
  }

  async function confirmImport() {
    if (!title.trim() || !chapters.length || !begin('import')) return
    try {
      // If opening a successfully imported novel fails, retry navigation only.
      const novel = imported ?? await api.import(title.trim(), chapters)
      if (!alive.current) return
      setImported(novel)
      await cache.invalidateQueries({ queryKey: ['novels'] })
      await onImported(novel)
    } catch (e) { if (alive.current) setError(errorText(e)) }
    finally { finish() }
  }

  function updateChapter(change: Partial<ImportChapter>) {
    setChapters(previous => previous.map((chapter, index) => index === selected ? { ...chapter, ...change } : chapter))
  }

  return <Modal open={open} dismissible={!busy} onOpenChange={value => !value && onClose()}
    title="导入已有手稿" description="先核对编码与章节切分；导入后的内容均为草稿。" wide className="edit-form-modal">
    <div className="bounded-edit-form" onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
      <fieldset disabled={busy || !!imported} className="edit-form-fields form-stack metadata-fields">
        <legend className="sr-only">导入手稿与章节预览</legend>
        <div className="form-row">
          <Field label="选择 TXT / Markdown"><input type="file" accept=".txt,.md,.markdown" onChange={e => {
            const chosen = e.target.files?.[0]
            if (chosen) { setFile(chosen); void decode(chosen, encoding) }
          }} /></Field>
          <Field label="文件编码"><select value={encoding} onChange={e => {
            setEncoding(e.target.value)
            if (file) void decode(file, e.target.value)
          }}><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="utf-16le">UTF-16 LE</option></select></Field>
        </div>
        <Field label="作品名"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} /></Field>
        {!chapters.length ? <Field label="手稿预览或粘贴正文"><textarea rows={8} value={text} onChange={e => {
          setText(e.target.value); setError('')
        }} placeholder="支持第X章标题；未识别到章节时将作为单章导入。" /></Field> : <div className="import-preview">
          <div className="import-chapters" aria-label="章节切分预览">{chapters.map((chapter, index) => <button type="button" className={index === selected ? 'selected' : ''}
            aria-pressed={index === selected} key={index} onClick={() => setSelected(index)}>{chapter.title}</button>)}</div>
          <div className="form-stack">
            <Field label="修正章节名"><input maxLength={240} value={chapters[selected]?.title ?? ''} onChange={e => updateChapter({ title: e.target.value })} /></Field>
            <Field label="章节正文"><textarea rows={8} maxLength={200000} value={chapters[selected]?.text ?? ''} onChange={e => updateChapter({ text: e.target.value })} /></Field>
          </div>
        </div>}
      </fieldset>
      {phase === 'read' && <p role="status" className="small muted">正在读取手稿…</p>}
      {imported && <Notice tone="green">手稿已导入。可以前往作品继续写作，或关闭窗口后在作品列表打开。</Notice>}
      {error && <Notice>{error}</Notice>}
      <div className="modal-actions">
        <Button disabled={busy} onClick={onClose}>{imported ? '关闭' : '取消'}</Button>
        {!!chapters.length && !imported && <Button disabled={busy} onClick={() => { setChapters([]); setSelected(0); setError('') }}>重新切分</Button>}
        {chapters.length ? <Button variant="primary" disabled={busy || !title.trim()} onClick={() => void confirmImport()}>
          {phase === 'import' ? '正在打开…' : imported ? '前往已导入作品' : `确认导入 ${chapters.length} 章`}
        </Button> : <Button variant="primary" disabled={busy || !text.trim()} onClick={() => void preview()}>{phase === 'preview' ? '正在切分…' : '预览章节切分'}</Button>}
      </div>
    </div>
  </Modal>
}
