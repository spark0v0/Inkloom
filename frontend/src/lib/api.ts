import type { components, operations } from '../generated/api'

type Schema = components['schemas']
export type Novel = Schema['NovelOut']
export type WritingPreferences = Schema['WritingPreferences']
export type Chapter = Schema['ChapterOut']
export type ChapterSummary = Schema['ChapterSummary']
export type ExportPreview = Schema['ExportPreviewOut']
export type ExportOptions = NonNullable<operations['export_api_v1_novels__novel_id__export_get']['parameters']['query']>
export type ReferenceSelection = Schema['ReferenceSelection']
export type ReferenceState = Schema['ReferenceState']
export type Version = Schema['VersionOut']
export type VersionSummary = Schema['VersionSummary']
export type Entity = Schema['EntityOut']
export type EntityInput = Schema['EntityInput']
export type Thread = Schema['ThreadOut']
export type ThreadProgressInput = Schema['ThreadProgressInput']
export type Plan = Schema['PlanOut']
export type PlanInput = Schema['PlanInput']
export type Fact = Schema['FactOut']
export type Evidence = Schema['Evidence']
export type Source = Schema['Source']
export type MemoryProposal = Schema['MemoryProposal']
export type Job = Schema['JobOut']
export type JobDetail = Schema['JobDetail']
export type JobProgress = Schema['JobProgress']
export type OutlineState = Schema['OutlineState']
export type OutlineDocument = OutlineState['document']
export type OutlineField = NonNullable<Schema['ContextInput']['outline_edit']>['fields'][number]
export type OutlineHistoryItem = Schema['OutlineHistoryItem']
export type OutlineRevision = Schema['OutlineRevisionOut']
export type JobInput = Schema['JobInput']
export type ReviewRewritePreparation = Schema['ReviewRewritePreparation']
export type ReviewFinding = Schema['Finding']
export type JobHistoryFilters = NonNullable<operations['job_history_api_v1_jobs_page_get']['parameters']['query']>
export type ContextInput = Schema['ContextInput']
export type Context = Schema['ContextOut']
export type Provider = Schema['ProviderOut']
export type ProviderInput = Schema['ProviderInput']
export type Roles = Schema['RoleConfig']
export type Selection = Schema['Selection']
export type Health = Schema['HealthOut']
export type ImportChapter = Schema['ImportChapter']
export type Restore = Schema['RestoreOut']
export type Task = ContextInput['task']
export type Blueprint = Schema['BlueprintResult']
export type Outline = Schema['OutlineResult']

export class ApiError extends Error {
  code: string
  details: Record<string, unknown>
  status: number
  constructor(code: string, message: string, details: Record<string, unknown> = {}, status = 0) {
    super(message)
    this.code = code
    this.details = details
    this.status = status
  }
}

export const uuid = () => crypto.randomUUID()
export const npath = (id: string) => `/novels/${encodeURIComponent(id)}`
export const cpath = (novel: string, chapter: string) => `${npath(novel)}/chapters/${encodeURIComponent(chapter)}`
export const jpath = (job: string, novel: string) => `/jobs/${encodeURIComponent(job)}?novel_id=${encodeURIComponent(novel)}`
export const exportQuery = (options: ExportOptions) => new URLSearchParams(Object.entries(options).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()

let activeWorkspace: string | undefined
export function bindWorkspace(id: string) { activeWorkspace = id }
const workspaceChanged = () => new ApiError('WORKSPACE_CHANGED', '工作区已切换，请重新载入。原页面的修改未写入当前工作区。', {}, 409)

async function workspaceFetch(path: string, init?: RequestInit, expected = activeWorkspace): Promise<Response> {
  const scoped = path !== '/health'
  if (scoped && expected !== activeWorkspace) throw workspaceChanged()
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (scoped && expected) headers.set('X-Inkloom-Workspace', expected)
  let response: Response
  try {
    response = await fetch('/api/v1' + path, {
      ...init,
      headers,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError('NETWORK_ERROR', '无法连接工作区。当前操作尚未确认，请保留页面内容后重试。')
  }
  if (scoped && expected !== activeWorkspace) throw workspaceChanged()
  if (!response.ok) {
    const value = await response.json().catch(() => null)
    throw new ApiError(value?.code ?? 'REQUEST_FAILED', value?.message ?? '操作未完成，请重试。', value?.details ?? {}, response.status)
  }
  return response
}

export async function request<T>(path: string, init?: RequestInit, expected = activeWorkspace): Promise<T> {
  const value = await (await workspaceFetch(path, init, expected)).json() as T
  if (path !== '/health' && expected !== activeWorkspace) throw workspaceChanged()
  return value
}

export const api = {
  health: () => request<Health>('/health'),
  novels: (archived = false) => request<Novel[]>(`/novels?archived=${archived}`),
  novel: (id: string) => request<Novel>(npath(id)),
  exportPreview: (id: string, options: Omit<ExportOptions, 'format' | 'expected_fingerprint'>) => request<ExportPreview>(`${npath(id)}/export-preview?${exportQuery(options)}`),
  createNovel: (data: Schema['NovelInput']) => request<Novel>('/novels', { method: 'POST', body: JSON.stringify(data) }),
  editNovel: (id: string, data: Schema['NovelUpdate']) => request<Novel>(npath(id), { method: 'PATCH', body: JSON.stringify(data) }),
  saveWritingStyle: (id: string, data: Schema['WritingStyleInput']) => request<Novel>(npath(id) + '/writing-style', { method: 'PUT', body: JSON.stringify(data) }),
  demo: () => request<Novel>('/demo', { method: 'POST' }),
  chapters: (id: string) => request<ChapterSummary[]>(npath(id) + '/chapters'),
  chapter: (id: string, chapter: string) => request<Chapter>(cpath(id, chapter)),
  createChapter: (id: string, data: Schema['ChapterInput']) => request<Chapter>(npath(id) + '/chapters', { method: 'POST', body: JSON.stringify(data) }),
  editChapter: (id: string, chapter: string, data: Schema['ChapterUpdate']) => request<Chapter>(cpath(id, chapter), { method: 'PATCH', body: JSON.stringify(data) }),
  chapterOutline: (id: string, chapter: string) => request<OutlineState>(cpath(id, chapter) + '/outline'),
  saveChapterOutline: (id: string, chapter: string, data: Schema['OutlineUpdate']) => request<OutlineState>(cpath(id, chapter) + '/outline', { method: 'PUT', body: JSON.stringify(data) }),
  outlineHistory: (id: string, chapter: string, before?: number) => request<Schema['OutlineHistoryPage']>(cpath(id, chapter) + '/outline/history' + (before == null ? '' : `?before=${before}`)),
  outlineRevision: (id: string, chapter: string, revision: number) => request<OutlineRevision>(cpath(id, chapter) + `/outline/history/${revision}`),
  restoreOutline: (id: string, chapter: string, revision: number, data: Schema['OutlineRestoreInput']) => request<OutlineState>(cpath(id, chapter) + `/outline/history/${revision}/restore`, { method: 'POST', body: JSON.stringify(data) }),
  applyOutlineEdit: (id: string, novel: string, data: Schema['OutlineApplyInput']) => request<OutlineState>(`/jobs/${encodeURIComponent(id)}/apply-outline-edit?novel_id=${encodeURIComponent(novel)}`, { method: 'POST', body: JSON.stringify(data) }),
  references: (id: string, chapter: string) => request<ReferenceState>(cpath(id, chapter) + '/references'),
  saveReferences: (id: string, chapter: string, data: Schema['ReferenceUpdate']) => request<ReferenceState>(cpath(id, chapter) + '/references', { method: 'PUT', body: JSON.stringify(data) }),
  save: (id: string, chapter: string, data: Schema['SaveInput'], workspace?: string) => request<Version>(cpath(id, chapter) + '/versions', { method: 'POST', body: JSON.stringify(data) }, workspace),
  versions: (id: string, chapter: string) => request<VersionSummary[]>(cpath(id, chapter) + '/versions'),
  version: (id: string, chapter: string, version: string) => request<Version>(cpath(id, chapter) + '/versions/' + encodeURIComponent(version)),
  confirm: (id: string, chapter: string, data: Schema['CanonInput']) => request<Schema['CanonOut']>(cpath(id, chapter) + '/canon', { method: 'POST', body: JSON.stringify(data) }),
  entities: (id: string) => request<Entity[]>(npath(id) + '/entities'),
  saveEntity: (id: string, data: EntityInput, entity?: string, baseUpdatedAt?: string) => request<Entity>(npath(id) + '/entities' + (entity ? '/' + entity : ''), { method: entity ? 'PUT' : 'POST', body: JSON.stringify(entity ? { ...data, base_updated_at: baseUpdatedAt } : data) }),
  plans: (id: string) => request<Plan[]>(npath(id) + '/plans'),
  plan: (id: string, plan: string) => request<Plan>(npath(id) + '/plans/' + encodeURIComponent(plan)),
  savePlan: (id: string, data: PlanInput) => request<Plan>(npath(id) + '/plans', { method: 'POST', body: JSON.stringify(data) }),
  editPlan: (id: string, plan: string, data: Schema['PlanUpdate']) => request<Plan>(npath(id) + '/plans/' + encodeURIComponent(plan), { method: 'PUT', body: JSON.stringify(data) }),
  facts: (id: string, inactive = false) => request<Fact[]>(npath(id) + '/facts?include_inactive=' + inactive),
  threads: (id: string) => request<Thread[]>(npath(id) + '/threads'),
  saveThreadPlan: (id: string, entity: string, data: Schema['ThreadPlanInput']) => request<Thread>(npath(id) + `/threads/${entity}`, { method: 'PUT', body: JSON.stringify(data) }),
  addThreadProgress: (id: string, entity: string, data: ThreadProgressInput) => request<Thread>(npath(id) + `/threads/${entity}/progress`, { method: 'POST', body: JSON.stringify(data) }),
  changeThreadProgress: (id: string, entity: string, progress: string, data: Schema['ThreadProgressChange']) => request<Thread>(npath(id) + `/threads/${entity}/progress/${progress}`, { method: 'PATCH', body: JSON.stringify(data) }),
  search: (id: string, q: string) => request<Schema['SearchResult'][]>(npath(id) + '/search?q=' + encodeURIComponent(q)),
  context: (id: string, data: ContextInput) => request<Context>(npath(id) + '/context', { method: 'POST', body: JSON.stringify(data) }),
  createJob: (id: string, data: JobInput) => request<JobDetail>(npath(id) + '/jobs', { method: 'POST', body: JSON.stringify(data) }),
  jobs: (id?: string, filters: { chapter_id?: string; task?: Task } = {}) => {
    const query = new URLSearchParams({ ...(id ? { novel_id: id } : {}), ...filters })
    return request<Job[]>('/jobs?' + query)
  },
  jobHistory: (filters: JobHistoryFilters = {}) => {
    const query = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => { if (value != null && value !== '') query.set(key, String(value)) })
    return request<Schema['JobHistoryPage']>('/jobs/page?' + query)
  },
  prepareReviewRewrite: (id: string, novel: string, data: Schema['ReviewRewriteInput']) => request<ReviewRewritePreparation>(`/jobs/${id}/prepare-rewrite?novel_id=${novel}`, { method: 'POST', body: JSON.stringify(data) }),
  job: (id: string, novel: string, signal?: AbortSignal) => request<JobDetail>(jpath(id, novel), { signal }),
  jobProgress: (id: string, novel: string, signal?: AbortSignal) => request<JobProgress>(`/jobs/${encodeURIComponent(id)}/progress?novel_id=${encodeURIComponent(novel)}`, { signal }),
  control: (id: string, novel: string, action: string) => request<JobDetail>(`/jobs/${id}/${action}?novel_id=${novel}`, { method: 'POST' }),
  adopt: (id: string, novel: string, base: string) => request<Version>(`/jobs/${id}/adopt?novel_id=${novel}`, { method: 'POST', body: JSON.stringify({ base_version_id: base }) }),
  applyPlan: (id: string, novel: string) => request<Schema['ProductionApplyOut']>(`/jobs/${id}/apply-plan?novel_id=${novel}`, { method: 'POST' }),
  decide: (id: string, novel: string, data: Schema['FindingDecision']) => request<JobDetail>(`/jobs/${id}/review-decision?novel_id=${novel}`, { method: 'POST', body: JSON.stringify(data) }),
  providers: () => request<Provider[]>('/providers'),
  saveProvider: (data: ProviderInput, id?: string) => request<Provider>('/providers' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }),
  checkProvider: (id: string) => request<Schema['ConnectionOut']>(`/providers/${id}/check`, { method: 'POST' }),
  roles: () => request<Roles>('/roles'),
  saveRoles: (roles: Roles) => request<Roles>('/roles', { method: 'PUT', body: JSON.stringify(roles) }),
  importPreview: (text: string) => request<ImportChapter[]>('/import-preview', { method: 'POST', body: JSON.stringify({ text }) }),
  import: (title: string, chapters: ImportChapter[]) => request<Novel>('/import', { method: 'POST', body: JSON.stringify({ title, chapters }) }),
  restore: (file: File) => request<Restore>('/workspace/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }),
  activate: (id: string) => request<Health>('/workspace/activate', { method: 'POST', body: JSON.stringify({ restore_id: id }) }),
  activateOriginal: () => request<Health>('/workspace/use-original', { method: 'POST' }),
}

export const taskNames: Record<Task, string> = {
  continue: '正文生成', rewrite: '改写', plan: '场景规划', extract: '本章记忆', review: '审稿', handoff: '章节交接', blueprint: '全书方案', outline: '章节细纲', inspiration: '剧情灵感', outline_edit: '细纲修改',
}
export const jobStateNames: Record<string, string> = {
  queued: '等待执行', running: '正在生成', pausing: '等待本次调用结束', paused: '已暂停', cancelling: '正在取消',
  cancelled: '已取消', succeeded: '候选已生成', failed: '执行未完成', interrupted_uncertain: '中断 · 需核实',
}
export const activeStates = new Set(['queued', 'running', 'pausing', 'cancelling'])
export const countChars = (text: string) => Array.from(text).filter(ch => !/\p{White_Space}/u.test(ch)).length
export const number = (n: number) => n.toLocaleString('zh-CN')
export const errorText = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。'
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadFile(path: string, name: string) {
  const response = await workspaceFetch(path)
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new ApiError(error.code ?? 'DOWNLOAD_FAILED', error.message ?? '下载未完成，请重试。')
  }
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
