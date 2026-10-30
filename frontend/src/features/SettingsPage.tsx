import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { ArrowRight, CheckCircle, PlugsConnected, Plus, SlidersHorizontal } from '@phosphor-icons/react'
import { api, errorText } from '../lib/api'
import type { Provider, ProviderInput, Roles } from '../lib/api'
import { Badge, Button, Field, Loading, Modal, Notice, PageHeading } from '../components/ui'

const roleNames: Record<keyof Roles, string> = { writer: '章节写作', planner: '全书与章节策划', extractor: '本章记忆', reviewer: '审稿' }
type ConnectionCheck = Awaited<ReturnType<typeof api.checkProvider>>
type CheckState = { revision: number; result?: ConnectionCheck; error?: string }

function ConnectionFeedback({ check, onSelect }: { check?: CheckState; onSelect: () => void }) {
  if (check?.error) return <Notice>{check.error}</Notice>
  if (!check?.result) return null
  const { result } = check
  const count = result.models?.length || 0
  return <Notice tone={result.model_listed ? 'green' : 'amber'}><p>{result.message}</p>{count > 0 && <Button variant="ghost" onClick={onSelect}>选择目录中的模型（{result.models_truncated ? '前 ' : ''}{count} 个）</Button>}</Notice>
}
export function SettingsPage() {
  const cache = useQueryClient()
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles })
  const [editing, setEditing] = useState<Provider | 'new' | null>(null)
  const [message, setMessage] = useState('')
  const [checking, setChecking] = useState<string | null>(null)
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  async function check(provider: Provider) {
    setChecking(provider.id); setChecks(values => ({ ...values, [provider.id]: { revision: provider.revision } }))
    try { const result = await api.checkProvider(provider.id); setChecks(values => ({ ...values, [provider.id]: { result, revision: provider.revision } })) }
    catch (e) { setChecks(values => ({ ...values, [provider.id]: { error: errorText(e), revision: provider.revision } })) } finally { setChecking(null) }
  }
  async function changeRole(role: keyof Roles, id: string) {
    if (!roles.data) return
    try { await api.saveRoles({ ...roles.data, [role]: id }); await cache.invalidateQueries({ queryKey: ['roles'] }); setMessage('已保存任务的默认模型。') }
    catch (e) { setMessage(errorText(e)) }
  }
  return <div className="page-scroll"><div className="content-page settings-page"><PageHeading title="模型设置" action={<Button variant="primary" onClick={() => setEditing('new')}><Plus size={17} />添加模型连接</Button>} /><Notice tone="neutral">正文与档案保存在本机。使用云模型时，你选中的上下文会发送到该连接显示的服务地址；演示模式不发送外部请求。</Notice>{message && <Notice tone="neutral">{message}</Notice>}{providers.isPending ? <Loading /> : providers.error ? <Notice>{errorText(providers.error)}</Notice> : <div className="provider-list">{providers.data?.map(p => <article className="provider-card" key={p.id}><div className="provider-card-top"><span className="provider-symbol"><PlugsConnected size={23} /></span><div><h2>{p.name}</h2></div><Badge tone={p.kind === 'demo' ? 'amber' : p.has_key ? 'green' : 'neutral'}>{p.kind === 'demo' ? '演示' : p.has_key ? '已配置密钥' : '未配置密钥'}</Badge></div><p className="provider-model">{p.kind === 'demo' ? '无需密钥 · 仅用于流程体验' : p.model}</p>{p.kind !== 'demo' && <><p className="provider-url">{p.base_url}</p><div className="provider-meta"><span>上下文 {p.context_window.toLocaleString()} tokens</span><span>输出上限 {p.max_output_tokens.toLocaleString()}</span><span>{p.input_price == null ? '价格未知' : `输入 ${p.input_price} / 输出 ${p.output_price} ${p.currency} 每百万 tokens`}</span></div><div className="button-row"><Button onClick={() => setEditing(p)}><SlidersHorizontal size={16} />配置连接</Button><Button variant="ghost" disabled={!!checking || !p.has_key} onClick={() => void check(p)}>{checking === p.id ? '正在检查…' : '检查连接'}<ArrowRight size={16} /></Button><span className="small muted">仅查询模型列表，不执行生成</span></div></>}{p.kind === 'demo' && <p className="small muted">固定的本地响应，显著标记演示状态。可以完整体验生成、比较、采纳与确认流程。</p>}{checks[p.id]?.revision === p.revision && <ConnectionFeedback check={checks[p.id]} onSelect={() => setEditing(p)} />}</article>)}</div>}
    <section className="settings-section"><div className="section-heading"><h2>按任务选择默认连接</h2><CheckCircle size={20} /></div><p className="muted">每次生成仍可修改。不会自动切换到其他服务商。</p>{roles.data && <div className="role-grid">{(Object.keys(roleNames) as (keyof Roles)[]).map(role => <Field key={role} label={roleNames[role]}><select value={roles.data[role]} onChange={e => void changeRole(role, e.target.value)}>{providers.data?.map(p => <option key={p.id} value={p.id}>{p.name} / {p.model}</option>)}</select></Field>)}</div>}{roles.error && <Notice>{errorText(roles.error)}</Notice>}</section>
    {editing && <ProviderDialog provider={editing === 'new' ? null : editing} models={editing !== 'new' && checks[editing.id]?.revision === editing.revision ? checks[editing.id]?.result?.models || [] : []} firstConnection={!providers.data?.some(p => p.kind !== 'demo')} onClose={() => { if (editing !== 'new') setChecks(values => { const next = { ...values }; delete next[editing.id]; return next }); setEditing(null) }} />}
  </div></div>
}

function ProviderDialog({ provider, onClose, firstConnection = false, models = [] }: { provider: Provider | null; onClose: () => void; firstConnection?: boolean; models?: string[] }) {
  const cache = useQueryClient()
  const [form, setForm] = useState<ProviderInput>({ clear_key: false, name: provider?.name || '', base_url: provider?.base_url || '', model: provider?.model || '', stream: provider?.stream ?? true, include_usage: provider?.include_usage ?? true, json_mode: provider?.json_mode ?? false, token_parameter: provider?.token_parameter === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens', context_window: provider?.context_window || 32000, max_output_tokens: provider?.max_output_tokens || 8000, key_env: provider?.key_env || '', currency: provider?.currency === 'USD' ? 'USD' : 'CNY', input_price: provider?.input_price, output_price: provider?.output_price, price_date: provider?.price_date })
  const connectionId = useRef(provider?.id)
  const [makeDefault, setMakeDefault] = useState(firstConnection && !provider)
  const [secret, setSecret] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [priced, setPriced] = useState(provider?.input_price != null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const saved = await api.saveProvider({ ...form, api_key: secret || null, clear_key: clearKey, input_price: priced ? form.input_price : null, output_price: priced ? form.output_price : null, price_date: priced ? form.price_date : null }, connectionId.current)
      connectionId.current = saved.id
      if (makeDefault) { await api.saveRoles({ writer: saved.id, planner: saved.id, extractor: saved.id, reviewer: saved.id }); await cache.invalidateQueries({ queryKey: ['roles'] }) }
      setSecret(''); await cache.invalidateQueries({ queryKey: ['providers'] }); onClose()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <Modal open onOpenChange={value => !value && onClose()} title={provider ? '配置模型连接' : '添加模型连接'} description="支持 Chat Completions 兼容接口。请依据服务文档填写，不同连接的协议能力可能不同。" wide className="edit-form-modal"><form onSubmit={e => { e.preventDefault(); void save() }} className="bounded-edit-form" autoComplete="off"><div className="edit-form-fields form-stack">{models.length > 0 && form.base_url === provider?.base_url && <Field label="从服务目录选择模型"><select value={models.includes(form.model) ? form.model : ''} onChange={e => { if (e.target.value) setForm({ ...form, model: e.target.value }) }}><option value="">选择模型，或在下方手动填写</option>{models.map(model => <option key={model} value={model}>{model}</option>)}</select></Field>}<div className="form-row"><Field label="连接名称"><input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：我的写作模型" /></Field><Field label="模型 ID"><input required maxLength={160} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="填写服务提供的精确模型名称" /></Field></div><Field label="服务地址" help="包含 /v1 等实际前缀。例如本地兼容服务的 http://127.0.0.1:1234/v1。"><input type="url" required maxLength={1000} value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })} placeholder="https://你的服务地址/v1" /></Field><Field label={provider?.has_key ? '替换 API Key（留空保留原密钥）' : 'API Key'} help="密钥仅提交到本机服务，Windows 使用系统加密存储，不随备份导出。"><input type="password" name="provider-key" autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={provider?.has_key ? '已配置，界面不会读回密钥' : '在此输入，不要在聊天中发送密钥'} /></Field><details><summary>环境变量与协议选项</summary><div className="form-stack"><Field label="从环境变量读取密钥（可选）" help="填写变量名，需在启动本机服务前设置。"><input maxLength={160} value={form.key_env} onChange={e => setForm({ ...form, key_env: e.target.value })} placeholder="MY_WRITING_API_KEY" /></Field>{provider?.has_key && <label className="checkbox-label"><input type="checkbox" checked={clearKey} onChange={e => setClearKey(e.target.checked)} />清除当前已存储密钥</label>}<div className="checkbox-list"><label><input type="checkbox" checked={form.stream} onChange={e => setForm({ ...form, stream: e.target.checked })} />流式响应</label><label><input type="checkbox" checked={form.include_usage} onChange={e => setForm({ ...form, include_usage: e.target.checked })} />请求流式 usage</label><label><input type="checkbox" checked={form.json_mode} onChange={e => setForm({ ...form, json_mode: e.target.checked })} />结构化任务支持 JSON mode</label></div><Field label="输出上限参数"><select value={form.token_parameter} onChange={e => setForm({ ...form, token_parameter: e.target.value as ProviderInput['token_parameter'] })}><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></select></Field></div></details><div className="form-row"><Field label="模型上下文窗口（tokens）"><input type="number" min={2048} max={2000000} required value={form.context_window} onChange={e => setForm({ ...form, context_window: Number(e.target.value) })} /></Field><Field label="单次输出上限（tokens）"><input type="number" min={64} max={64000} required value={form.max_output_tokens} onChange={e => setForm({ ...form, max_output_tokens: Number(e.target.value) })} /></Field></div><label className="checkbox-label"><input type="checkbox" checked={priced} onChange={e => setPriced(e.target.checked)} />配置有来源日期的价格，用于费用预估</label>{priced && <><div className="form-row"><Field label="输入价格 / 百万 tokens"><input required type="number" min={0} step="any" value={form.input_price ?? ''} onChange={e => setForm({ ...form, input_price: e.target.value === '' ? null : Number(e.target.value) })} /></Field><Field label="输出价格 / 百万 tokens"><input required type="number" min={0} step="any" value={form.output_price ?? ''} onChange={e => setForm({ ...form, output_price: e.target.value === '' ? null : Number(e.target.value) })} /></Field></div><div className="form-row"><Field label="币种"><select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value as 'CNY' | 'USD' })}><option value="CNY">CNY</option><option value="USD">USD</option></select></Field><Field label="价格确认日期"><input required type="date" value={form.price_date || ''} onChange={e => setForm({ ...form, price_date: e.target.value })} /></Field></div><p className="small muted">输入是粗略估算，实际费用按服务返回的 usage 计算；缺失用量时仍显示未知。</p></>}<label className="checkbox-label"><input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} />同时设为默认创作模型（策划、写作、记忆与审稿）</label></div>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存连接'}</Button></div></form></Modal>
}
