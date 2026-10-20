import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowRight, DownloadSimple, ShieldCheck, UploadSimple } from '@phosphor-icons/react'
import { api, downloadFile, errorText } from '../lib/api'
import type { Health, Restore } from '../lib/api'
import { Badge, Button, Field, Modal, Notice, PageHeading } from '../components/ui'

export function BackupPage({ health }: { health: Health }) {
  const cache = useQueryClient()
  const [restore, setRestore] = useState<Restore | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [originalOpen, setOriginalOpen] = useState(false)
  async function backup() {
    setBusy(true); setError('')
    try { await downloadFile('/workspace/backup', `叙事工坊-备份-${new Date().toISOString().slice(0, 10)}.zip`); setDownloaded(true) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function validate() {
    if (!file) return
    setBusy(true); setError('')
    try { setRestore(await api.restore(file)) }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function activate() {
    if (!restore) return
    setBusy(true)
    try { await api.activate(restore.restore_id); cache.clear(); location.hash = '#/library'; location.reload() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function useOriginal() {
    setBusy(true)
    try { await api.activateOriginal(); cache.clear(); location.hash = '#/library'; location.reload() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="page-scroll"><div className="content-page backup-page"><PageHeading title="工作区备份" description="故事属于你。随时带走正文、历史版本、设定与生成记录。" /><div className="workspace-card"><span className="workspace-icon"><Archive size={29} weight="light" /></span><div><span className="eyebrow">当前工作区</span><h2>{health.workspace_name}</h2><p className="small muted">{health.workspace_id}</p></div><Badge tone="green">本机存储</Badge></div>{health.is_restored && <Notice tone="neutral" action={<Button onClick={() => setOriginalOpen(true)}>返回原工作区</Button>}>当前正在使用从备份恢复的工作区，原工作区仍保留。</Notice>}<div className="backup-grid"><section className="backup-section"><DownloadSimple size={29} weight="light" /><h2>留下一份完整备份</h2><p>保存一致的工作区快照，包括作品、正文版本、正史、档案和任务记录。</p><ul><li>包含完整数据库与校验清单</li><li>不包含 API Key 与浏览器恢复副本</li><li>无需停止写作，也能创建一致快照</li></ul><Button variant="primary" disabled={busy} onClick={() => void backup()}><DownloadSimple size={18} />下载工作区备份</Button>{downloaded && <p className="small success-text">备份已交给浏览器下载，请确认保存位置。</p>}</section><section className="backup-section"><UploadSimple size={29} weight="light" /><h2>从备份继续故事</h2><p>先在新目录校验备份，确认后切换。原工作区保留在本机，不会被覆盖。</p><Field label="选择工作区备份" help="仅支持本应用生成的 ZIP，最大 64 MB。"><input type="file" accept=".zip,application/zip" onChange={e => { setFile(e.target.files?.[0] || null); setRestore(null) }} /></Field><Button disabled={!file || busy} onClick={() => void validate()}><ShieldCheck size={18} />{busy ? '正在校验…' : '校验并预览备份'}</Button></section></div>{error && <Notice>{error}</Notice>}<div className="backup-note"><ShieldCheck size={20} /><p>恢复时会检查归档路径、数据库完整性、版本内容和校验值。恢复出的模型连接需要重新配置密钥；未完成的调用会保留为待核实状态。</p></div><Modal open={!!restore} onOpenChange={value => !value && setRestore(null)} title="备份已通过校验" description="这是切换前的最后一步。请确认切换到恢复出的工作区，原工作区仍保留在本机。"><div className="restore-stats"><div><strong>{restore?.novel_count}</strong><span>部作品</span></div><div><strong>{restore?.chapter_count}</strong><span>个章节</span></div></div><p>{restore?.message}</p><Notice tone="neutral">请先结束正在运行的任务。切换后页面将重新载入，不会合并两个工作区的数据。</Notice>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={() => setRestore(null)}>保留当前工作区</Button><Button variant="primary" disabled={busy} onClick={() => void activate()}>切换到恢复的工作区<ArrowRight size={17} /></Button></div></Modal><Modal open={originalOpen} onOpenChange={setOriginalOpen} title="返回原工作区" description="恢复出的工作区也会保留。切换不会合并数据，页面将重新载入。"><p>请先结束生成任务，然后返回恢复前的原工作区。</p>{error && <Notice>{error}</Notice>}<div className="modal-actions"><Button onClick={() => setOriginalOpen(false)}>继续使用当前工作区</Button><Button variant="primary" onClick={() => void useOriginal()} disabled={busy}>确认返回原工作区</Button></div></Modal></div></div>
}
