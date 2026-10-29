import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, api, errorText, number } from '../lib/api'
import type { Novel } from '../lib/api'
import { Button, Field, Modal, Notice } from '../components/ui'

const fields = ['title', 'genre', 'premise', 'style', 'platform', 'target_words', 'chapter_words'] as const
type Brief = Pick<Novel, typeof fields[number]>
const briefOf = (novel: Novel) => Object.fromEntries(fields.map(key => [key, novel[key]])) as Brief

export function NovelBriefDialog({ novel, onClose }: { novel: Novel; onClose: () => void }) {
  const cache = useQueryClient()
  const [base, setBase] = useState(novel)
  const [form, setForm] = useState(() => briefOf(novel))
  const [touched, setTouched] = useState(new Set<keyof Brief>())
  const [latest, setLatest] = useState<Novel | null>(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const composing = useRef(false)
  function change<K extends keyof Brief>(key: K, value: Brief[K]) {
    setForm(previous => ({ ...previous, [key]: value }))
    setTouched(previous => new Set([...previous, key]))
  }
  async function save() {
    if (busy || composing.current) return
    setBusy(true); setError('')
    try {
      const changes = Object.fromEntries([...touched].map(key => [key, form[key]]))
      const saved = await api.editNovel(novel.id, { ...changes, base_settings_revision: base.settings_revision })
      cache.setQueryData(['novel', novel.id], saved)
      await Promise.all([['novels'], ['plans', novel.id], ['jobs', novel.id], ['job']].map(queryKey => cache.invalidateQueries({ queryKey })))
      onClose()
    } catch (e) { setError(errorText(e)); setConflict(e instanceof ApiError && e.code === 'NOVEL_CONFLICT') }
    finally { setBusy(false) }
  }
  async function readLatest() {
    if (busy) return
    setBusy(true)
    try {
      const value = await api.novel(novel.id)
      setForm(previous => ({ ...briefOf(value), ...Object.fromEntries([...touched].map(key => [key, previous[key]])) }))
      setBase(value); setLatest(value); setConflict(false); setError('')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open dismissible={!busy} onOpenChange={value => !value && !busy && onClose()} title="编辑作品" wide>
    <form className="form-stack" onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset disabled={busy} className="form-stack metadata-fields"><legend className="sr-only">作品信息</legend>
        <div className="form-row"><Field label="作品名"><input required maxLength={160} value={form.title} onChange={e => change('title', e.target.value)} /></Field><Field label="题材"><input maxLength={80} value={form.genre} onChange={e => change('genre', e.target.value)} /></Field></div>
        <div className="form-row"><Field label="目标平台"><select value={form.platform} onChange={e => change('platform', e.target.value)}><option>番茄小说</option><option>起点中文网</option><option>自由创作</option></select></Field><Field label="目标字数"><input type="number" required min={10000} max={10000000} step={10000} value={form.target_words} onChange={e => change('target_words', Number(e.target.value))} /></Field></div>
        <Field label="每章字数"><select value={form.chapter_words} onChange={e => change('chapter_words', Number(e.target.value))}>{[1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000].map(n => <option value={n} key={n}>{number(n)} 字</option>)}</select></Field>
        <Field label="故事想法"><textarea rows={4} maxLength={12000} value={form.premise} onChange={e => change('premise', e.target.value)} /></Field>
        <Field label="文风偏好"><textarea rows={3} maxLength={8000} value={form.style} onChange={e => change('style', e.target.value)} /></Field>
      </fieldset>
      {latest && <Notice tone="neutral">你的修改仍保留，未修改的字段已采用最新内容。<details><summary>查看最新作品信息</summary><h3>{latest.title}</h3><p>{latest.genre} · {latest.platform}</p><p>{latest.premise}</p><p>{latest.style}</p></details></Notice>}
      {error && <Notice>{error}{conflict && <Button disabled={busy} onClick={() => void readLatest()}>读取最新作品信息并比较</Button>}</Notice>}
      <div className="modal-actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存'}</Button></div>
    </form>
  </Modal>
}
