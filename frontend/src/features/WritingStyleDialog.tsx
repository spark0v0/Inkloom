import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, api, errorText } from '../lib/api'
import type { Novel, WritingPreferences } from '../lib/api'
import { emptyPreferences, negativeConstraintPills, stylePresets, viewpointNames } from '../lib/writing'
import { Button, Field, Modal, Notice } from '../components/ui'

export function WritingStyleDialog({ novel, onClose }: { novel: Novel; onClose: () => void }) {
  const cache = useQueryClient()
  const language = useRef<HTMLTextAreaElement>(null)
  const [style, setStyle] = useState(novel.style)
  const [preferences, setPreferences] = useState<WritingPreferences>({ ...emptyPreferences, ...novel.writing_preferences })
  const [revision, setRevision] = useState(novel.settings_revision)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [latest, setLatest] = useState<Novel | null>(null)
  const [custom, setCustom] = useState(false)
  const preset = !custom && stylePresets.find(item => item.style === style && item.viewpoint === preferences.viewpoint && item.avoid === preferences.avoid)?.name
  function change<K extends keyof WritingPreferences>(key: K, value: WritingPreferences[K]) {
    setPreferences(previous => ({ ...previous, [key]: value })); setCustom(true)
  }
  async function save() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const value = await api.saveWritingStyle(novel.id, { base_settings_revision: revision, style, preferences })
      cache.setQueryData(['novel', novel.id], value)
      await Promise.all([['novels'], ['jobs', novel.id], ['job']].map(queryKey => cache.invalidateQueries({ queryKey })))
      onClose()
    } catch (e) { setError(errorText(e)); setConflict(e instanceof ApiError && e.code === 'WRITING_STYLE_CONFLICT') }
    finally { setBusy(false) }
  }
  async function readLatest() {
    setBusy(true)
    try { const value = await api.novel(novel.id); setLatest(value); setRevision(value.settings_revision); setConflict(false); setError('') }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && !busy && onClose()} dismissible={!busy} title="写作风格" wide className="writing-style-modal">
    <form className="form-stack" onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="writing-style-scroll"><fieldset disabled={busy} className="form-stack writing-style-fields"><legend className="sr-only">本书写作风格</legend>
        <div className="style-preset-row" role="group" aria-label="风格模板"><Button aria-pressed={!preset} onClick={() => { setCustom(true); language.current?.focus() }}>自定义</Button>{stylePresets.map(item => <Button key={item.name} aria-pressed={preset === item.name} onClick={() => { setStyle(item.style); setPreferences(previous => ({ ...previous, viewpoint: item.viewpoint, avoid: item.avoid })); setCustom(false) }}>{item.name}</Button>)}</div>
        <Field label="叙述视角"><select value={preferences.viewpoint} onChange={e => change('viewpoint', e.target.value as WritingPreferences['viewpoint'])}>{Object.entries(viewpointNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field>
        <Field label="语言与节奏"><textarea ref={language} rows={4} maxLength={8000} value={style} onChange={e => { setStyle(e.target.value); setCustom(true) }} placeholder="希望怎样讲述这个故事？可直接写自己的要求。" /></Field>
        <Field label="避免的写法（可选）" help="点击下方快捷标签可快速添加常见 AI 禁忌词。"><textarea rows={3} maxLength={1200} value={preferences.avoid} onChange={e => change('avoid', e.target.value)} placeholder="例如：避免频繁倒吸凉气、避免作者跳出视角说教、避免连续解释设定…" /></Field>
        <div className="style-preset-row" style={{ flexWrap: 'wrap', gap: '6px' }} role="group" aria-label="常见禁忌快捷标签">{negativeConstraintPills.map(pill => <Button key={pill} type="button" variant="ghost" onClick={() => { const current = preferences.avoid.trim(); if (!current.includes(pill)) change('avoid', current ? `${current}；${pill}` : pill) }}>+ {pill}</Button>)}</div>
        <details className="style-example"><summary>作者示例（只参考文风）{preferences.example ? ' · 已填写' : ''}</summary><Field label="表达示例" help="仅参考表达方式，示例中的人物和事件不会成为故事事实。"><textarea rows={5} maxLength={4000} value={preferences.example} onChange={e => change('example', e.target.value)} placeholder="粘贴你有权使用的短段落，也可以留空。" /></Field></details>
      </fieldset></div>
      {latest && <Notice tone="neutral">你的输入仍保留，请比较后再保存。<details><summary>查看当前已保存风格</summary><p>{viewpointNames[latest.writing_preferences?.viewpoint || 'unspecified']}</p><p>{latest.style || '未填写语言与节奏'}</p><p>{latest.writing_preferences?.avoid}</p><blockquote>{latest.writing_preferences?.example}</blockquote></details></Notice>}
      {error && <Notice>{error}{conflict && <Button disabled={busy} onClick={() => void readLatest()}>读取最新风格</Button>}</Notice>}
      <div className="modal-actions"><span className="small muted">保存不会生成正文</span><Button disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存风格'}</Button></div>
    </form>
  </Modal>
}
