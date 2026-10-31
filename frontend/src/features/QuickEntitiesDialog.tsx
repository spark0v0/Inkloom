import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { MagnifyingGlass, User, GlobeHemisphereWest, GitBranch, Clock } from '@phosphor-icons/react'
import { api, errorText } from '../lib/api'
import type { Chapter } from '../lib/api'
import { Badge, Button, Empty, Loading, Modal, Notice } from '../components/ui'

const kinds = { character: '人物', world: '世界设定', thread: '伏笔', timeline: '时间线' } as const
const icons = { character: User, world: GlobeHemisphereWest, thread: GitBranch, timeline: Clock }

type Props = {
  novelId: string
  chapter: Chapter
  onClose: () => void
  onReferencesChanged?: () => void
}

export function QuickEntitiesDialog({ novelId, chapter, onClose, onReferencesChanged }: Props) {
  const cache = useQueryClient()
  const entities = useQuery({ queryKey: ['entities', novelId], queryFn: () => api.entities(novelId) })
  const currentRefs = useQuery({ queryKey: ['references', novelId, chapter.id], queryFn: () => api.references(novelId, chapter.id) })
  const relations = useQuery({ queryKey: ['relations', novelId], queryFn: () => api.relations(novelId) })

  const [search, setSearch] = useState('')
  const [filterKind, setFilterKind] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const activeRefSelection = currentRefs.data?.selection || chapter.references
  const activeEntityIds = activeRefSelection.entity_ids || []
  const revision = currentRefs.data?.revision ?? chapter.references_revision

  const allItems = entities.data || []
  const query = search.trim().toLowerCase()
  const filtered = allItems.filter(item => {
    if (filterKind !== 'all' && item.kind !== filterKind) return false
    if (!query) return true
    const text = `${item.name} ${item.summary} ${item.body} ${item.aliases?.join(' ')}`.toLowerCase()
    return text.includes(query)
  })

  async function togglePin(entityId: string) {
    setSavingId(entityId)
    setError('')
    try {
      const isPinned = activeEntityIds.includes(entityId)
      const nextIds = isPinned ? activeEntityIds.filter(id => id !== entityId) : [...activeEntityIds, entityId]
      const nextSelection = { ...activeRefSelection, entity_ids: nextIds }
      await api.saveReferences(novelId, chapter.id, { selection: nextSelection, base_revision: revision })
      await cache.invalidateQueries({ queryKey: ['references', novelId, chapter.id] })
      await cache.invalidateQueries({ queryKey: ['chapters', novelId] })
      onReferencesChanged?.()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Modal
      open
      onOpenChange={v => !v && onClose()}
      title="速查故事设定与主角状态"
      description="在写作中快速调阅人物、外挂与世界设定；可直接将核心设定设为本章必读。"
      wide
    >
      <div className="quick-entities-modal form-stack">
        <div className="section-toolbar" style={{ gap: '8px', flexWrap: 'wrap' }}>
          <label className="search-input" style={{ flex: 1, minWidth: '220px' }}>
            <MagnifyingGlass size={17} />
            <input
              aria-label="搜索设定"
              placeholder="搜索人物名、外挂、境界、别名…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </label>
          <div className="filter-pills" role="group" aria-label="类型筛选" style={{ display: 'flex', gap: '4px' }}>
            <Button
              type="button"
              variant={filterKind === 'all' ? 'primary' : 'ghost'}
              onClick={() => setFilterKind('all')}
            >
              全部 ({allItems.length})
            </Button>
            {Object.entries(kinds).map(([k, label]) => {
              const count = allItems.filter(item => item.kind === k).length
              return (
                <Button
                  key={k}
                  type="button"
                  variant={filterKind === k ? 'primary' : 'ghost'}
                  onClick={() => setFilterKind(k)}
                >
                  {label} ({count})
                </Button>
              )
            })}
          </div>
        </div>

        {error && <Notice>{error}</Notice>}

        {entities.isPending ? (
          <Loading />
        ) : entities.error ? (
          <Notice>{errorText(entities.error)}</Notice>
        ) : filtered.length === 0 ? (
          <Empty
            icon={<User size={32} weight="light" />}
            title={search ? '没有找到相关设定' : '暂无设定档案'}
          >
            {search ? '试试主角名、法宝、别名或功法关键词。' : '可以在“人物与设定”页面录入主角状态与世界观。'}
          </Empty>
        ) : (
          <div className="quick-entities-list form-stack" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            {filtered.map(item => {
              const Icon = icons[item.kind]
              const isPinned = activeEntityIds.includes(item.id)
              const isExpanded = expandedId === item.id
              const isBusy = savingId === item.id
              return (
                <article
                  key={item.id}
                  className="quick-entity-card"
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    background: isPinned ? 'var(--surface-hover, rgba(0, 128, 128, 0.05))' : 'var(--paper)'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Icon size={18} />
                      <strong style={{ fontSize: '15px' }}>{item.name}</strong>
                      <Badge tone={item.status === 'proposed' ? 'amber' : 'neutral'}>
                        {kinds[item.kind]}
                      </Badge>
                      {item.aliases && item.aliases.length > 0 && (
                        <span className="small muted">
                          别名: {item.aliases.slice(0, 3).join('、')}
                          {item.aliases.length > 3 ? ` 等${item.aliases.length}个` : ''}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Button
                        type="button"
                        variant={isPinned ? 'ghost' : 'primary'}
                        disabled={isBusy}
                        onClick={() => void togglePin(item.id)}
                        title={isPinned ? '从本章必读中移除' : '将此设定固定至本章写作提示词上下文'}
                      >
                        {isBusy ? '保存中…' : isPinned ? '已加入本章必读' : '+ 设为本章必读'}
                      </Button>
                      {item.body && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        >
                          {isExpanded ? '收起详情' : '展开详情'}
                        </Button>
                      )}
                    </div>
                  </div>

                  {item.summary && (
                    <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
                      {item.summary}
                    </p>
                  )}

                  {(() => {
                    const itemRelations = (relations.data || []).filter(r => r.source_id === item.id || (r.target_id === item.id && r.bidirectional))
                    if (itemRelations.length === 0) return null
                    return (
                      <div className="quick-entity-relations" style={{ marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span className="small muted">羁绊:</span>
                        {itemRelations.slice(0, 3).map(r => {
                          const partner = r.source_id === item.id ? r.target_name : r.source_name
                          return (
                            <Badge key={r.id} tone="neutral">
                              {r.relation_type}: {partner}
                            </Badge>
                          )
                        })}
                        {itemRelations.length > 3 && <span className="small muted">等{itemRelations.length}条关系</span>}
                      </div>
                    )
                  })()}

                  {isExpanded && item.body && (
                    <div
                      className="entity-expanded-body"
                      style={{
                        marginTop: '10px',
                        padding: '10px 12px',
                        background: 'var(--surface)',
                        borderRadius: '6px',
                        fontSize: '13px',
                        whiteSpace: 'pre-wrap',
                        lineHeight: '1.6'
                      }}
                    >
                      {item.body}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '12px' }}>
          <Button type="button" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  )
}
