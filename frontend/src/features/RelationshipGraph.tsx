import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash, User, ArrowsLeftRight, ArrowRight, MagnifyingGlass, Sparkle } from '@phosphor-icons/react'
import { api, errorText } from '../lib/api'
import type { Entity, Relation, RelationInput } from '../lib/api'
import { Badge, Button, Empty, Field, Loading, Modal, Notice } from '../components/ui'

const PRESET_RELATIONS = [
  { label: '道侣 / 情缘', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' },
  { label: '生死大敌 / 仇怨', color: '#e11d48', bg: 'rgba(225, 29, 72, 0.1)' },
  { label: '师徒 / 护道者', color: '#0f766e', bg: 'rgba(15, 118, 110, 0.1)' },
  { label: '同门师兄弟', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.1)' },
  { label: '盟友 / 合作者', color: '#0d9488', bg: 'rgba(13, 148, 136, 0.1)' },
  { label: '主仆 / 契约灵兽', color: '#64748b', bg: 'rgba(100, 116, 139, 0.1)' },
  { label: '同族 / 血亲', color: '#d97706', bg: 'rgba(217, 119, 6, 0.1)' }
]

function getRelationColor(type: string): { color: string; bg: string } {
  const found = PRESET_RELATIONS.find(p => p.label.includes(type) || type.includes(p.label.split(' / ')[0]))
  if (found) return found
  if (type.includes('敌') || type.includes('仇') || type.includes('杀')) return { color: '#e11d48', bg: 'rgba(225, 29, 72, 0.1)' }
  if (type.includes('情') || type.includes('侣') || type.includes('妻') || type.includes('夫')) return { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' }
  if (type.includes('师') || type.includes('徒')) return { color: '#0f766e', bg: 'rgba(15, 118, 110, 0.1)' }
  return { color: '#0d9488', bg: 'rgba(13, 148, 136, 0.1)' }
}

type Props = {
  novelId: string
  onSelectEntity?: (entity: Entity) => void
}

export function RelationshipGraph({ novelId, onSelectEntity }: Props) {
  const cache = useQueryClient()
  const entitiesQuery = useQuery({ queryKey: ['entities', novelId], queryFn: () => api.entities(novelId) })
  const relationsQuery = useQuery({ queryKey: ['relations', novelId], queryFn: () => api.relations(novelId) })

  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRelation, setEditingRelation] = useState<Relation | null>(null)
  const [error, setError] = useState('')

  const characters = useMemo(() => {
    return (entitiesQuery.data || []).filter(e => e.kind === 'character')
  }, [entitiesQuery.data])

  const allRelations = relationsQuery.data || []

  // Filtered relations based on category and search
  const visibleRelations = useMemo(() => {
    return allRelations.filter(r => {
      if (filterType !== 'all' && !r.relation_type.includes(filterType)) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const match = r.source_name.toLowerCase().includes(q) ||
          r.target_name.toLowerCase().includes(q) ||
          r.relation_type.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
        if (!match) return false
      }
      return true
    })
  }, [allRelations, filterType, search])

  // Related entity IDs when one is selected
  const connectedIds = useMemo(() => {
    if (!selectedEntityId) return new Set<string>()
    const set = new Set<string>([selectedEntityId])
    for (const r of allRelations) {
      if (r.source_id === selectedEntityId) set.add(r.target_id)
      if (r.target_id === selectedEntityId && r.bidirectional) set.add(r.source_id)
    }
    return set
  }, [selectedEntityId, allRelations])

  // Selected character's direct relations
  const selectedCharacterRelations = useMemo(() => {
    if (!selectedEntityId) return []
    return allRelations.filter(r => r.source_id === selectedEntityId || (r.target_id === selectedEntityId && r.bidirectional))
  }, [selectedEntityId, allRelations])

  // Node layout calculation
  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    const count = characters.length
    if (count === 0) return map

    const cx = 380
    const cy = 240
    const rx = 280
    const ry = 180

    characters.forEach((char, idx) => {
      const angle = (idx / count) * 2 * Math.PI - Math.PI / 2
      const x = cx + rx * Math.cos(angle)
      const y = cy + ry * Math.sin(angle)
      map.set(char.id, { x: Math.round(x), y: Math.round(y) })
    })

    return map
  }, [characters])

  async function handleDeleteRelation(relId: string) {
    if (!confirm('确定要删除这条人物关系吗？')) return
    try {
      await api.deleteRelation(novelId, relId)
      await cache.invalidateQueries({ queryKey: ['relations', novelId] })
    } catch (e) {
      setError(errorText(e))
    }
  }

  const selectedEntity = characters.find(c => c.id === selectedEntityId)

  return (
    <div className="relationship-graph-container form-stack" style={{ gap: '16px' }}>
      <div className="section-toolbar" style={{ gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '240px' }}>
          <label className="search-input" style={{ flex: 1 }}>
            <MagnifyingGlass size={17} />
            <input
              placeholder="搜索角色名、关系类型或描述…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="搜索关系图谱"
            />
          </label>
        </div>

        <div className="filter-pills" role="group" aria-label="关系筛选" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <Button
            type="button"
            variant={filterType === 'all' ? 'primary' : 'ghost'}
            onClick={() => setFilterType('all')}
            style={{ fontSize: '12px', padding: '4px 8px' }}
          >
            全部关系 ({allRelations.length})
          </Button>
          {['道侣', '敌对', '师徒', '同门', '盟友'].map(type => (
            <Button
              key={type}
              type="button"
              variant={filterType === type ? 'primary' : 'ghost'}
              onClick={() => setFilterType(type)}
              style={{ fontSize: '12px', padding: '4px 8px' }}
            >
              {type}
            </Button>
          ))}
        </div>

        <Button
          variant="primary"
          onClick={() => {
            setEditingRelation(null)
            setDialogOpen(true)
          }}
          disabled={characters.length < 2}
        >
          <Plus size={17} />
          添加关系
        </Button>
      </div>

      {error && <Notice>{error}</Notice>}

      {entitiesQuery.isPending || relationsQuery.isPending ? (
        <Loading />
      ) : characters.length < 2 ? (
        <Empty
          icon={<User size={32} weight="light" />}
          title="需要至少两个人物"
        >
          在“人物”标签中先录入主角与核心配角，随后可在此绘制全书人物羁绊与敌友关系图谱。
        </Empty>
      ) : (
        <div
          className="graph-workspace-layout"
          style={{
            display: 'grid',
            gridTemplateColumns: selectedEntity ? '1fr 300px' : '1fr',
            gap: '16px',
            alignItems: 'start'
          }}
        >
          {/* SVG Graph Canvas */}
          <div
            className="graph-canvas-wrapper"
            style={{
              background: 'var(--paper)',
              border: '1px solid var(--line)',
              borderRadius: '8px',
              padding: '12px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ position: 'absolute', top: '12px', left: '16px', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 2 }}>
              <Badge tone="green">
                <Sparkle size={14} style={{ marginRight: '3px' }} />
                人物羁绊网 ({characters.length} 角色 · {allRelations.length} 条关系)
              </Badge>
              <span className="small muted">点击节点聚焦人际圈；同场登场时将自动注入生成提示词</span>
            </div>

            <svg
              viewBox="0 0 760 480"
              style={{ width: '100%', height: 'auto', minHeight: '440px', display: 'block' }}
              onClick={e => {
                if (e.target === e.currentTarget) setSelectedEntityId(null)
              }}
            >
              <defs>
                <marker
                  id="arrow-head"
                  viewBox="0 0 10 10"
                  refX="18"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
                </marker>
              </defs>

              {/* Relationship Links */}
              {visibleRelations.map(rel => {
                const p1 = nodePositions.get(rel.source_id)
                const p2 = nodePositions.get(rel.target_id)
                if (!p1 || !p2) return null

                const isConnected = selectedEntityId
                  ? (rel.source_id === selectedEntityId || rel.target_id === selectedEntityId)
                  : true
                const { color } = getRelationColor(rel.relation_type)

                const midX = (p1.x + p2.x) / 2
                const midY = (p1.y + p2.y) / 2

                return (
                  <g
                    key={rel.id}
                    opacity={isConnected ? 1 : 0.15}
                    style={{ transition: 'opacity 0.2s ease' }}
                  >
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={color}
                      strokeWidth={isConnected && selectedEntityId ? 2.5 : 1.5}
                      strokeDasharray={rel.bidirectional ? undefined : '4 3'}
                    />
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect
                        x="-30"
                        y="-10"
                        width="60"
                        height="20"
                        rx="10"
                        fill="var(--paper)"
                        stroke={color}
                        strokeWidth="1"
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="11"
                        fill={color}
                        fontWeight="600"
                      >
                        {rel.relation_type.slice(0, 5)}
                      </text>
                    </g>
                  </g>
                )
              })}

              {/* Character Nodes */}
              {characters.map(char => {
                const pos = nodePositions.get(char.id)
                if (!pos) return null

                const isSelected = selectedEntityId === char.id
                const isConnected = selectedEntityId ? connectedIds.has(char.id) : true

                return (
                  <g
                    key={char.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
                    opacity={isConnected ? 1 : 0.25}
                    onClick={e => {
                      e.stopPropagation()
                      setSelectedEntityId(current => (current === char.id ? null : char.id))
                    }}
                  >
                    <circle
                      r={isSelected ? 26 : 22}
                      fill={isSelected ? 'var(--accent)' : 'var(--paper)'}
                      stroke={isSelected ? 'var(--accent)' : 'var(--line)'}
                      strokeWidth={isSelected ? 3 : 2}
                      style={{ transition: 'all 0.2s ease' }}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="14"
                      fontWeight="bold"
                      fill={isSelected ? '#fff' : 'var(--ink)'}
                    >
                      {char.name.slice(0, 1)}
                    </text>
                    <text
                      textAnchor="middle"
                      y={34}
                      fontSize="12"
                      fontWeight={isSelected ? 'bold' : 'normal'}
                      fill="var(--ink)"
                    >
                      {char.name}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Side Inspector when character selected */}
          {selectedEntity && (
            <aside
              className="selected-character-inspector form-stack"
              style={{
                border: '1px solid var(--line)',
                borderRadius: '8px',
                padding: '16px',
                background: 'var(--paper)',
                maxHeight: '520px',
                overflowY: 'auto'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <User size={20} />
                  <strong>{selectedEntity.name}</strong>
                </div>
                <Button
                  variant="ghost"
                  style={{ fontSize: '11px', padding: '2px 6px' }}
                  onClick={() => setSelectedEntityId(null)}
                >
                  收起
                </Button>
              </div>

              {selectedEntity.summary && (
                <p className="small muted" style={{ margin: '4px 0 8px' }}>
                  {selectedEntity.summary}
                </p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                <span className="small">人际关系 ({selectedCharacterRelations.length})</span>
                <Button
                  variant="primary"
                  style={{ fontSize: '12px', padding: '3px 8px' }}
                  onClick={() => {
                    setEditingRelation(null)
                    setDialogOpen(true)
                  }}
                >
                  <Plus size={14} />
                  建立关系
                </Button>
              </div>

              {selectedCharacterRelations.length === 0 ? (
                <p className="small muted" style={{ textAlign: 'center', padding: '16px 0' }}>
                  该角色暂未建立与他人的关系线。
                </p>
              ) : (
                <div className="inspector-relations-list form-stack" style={{ gap: '8px' }}>
                  {selectedCharacterRelations.map(rel => {
                    const isSource = rel.source_id === selectedEntity.id
                    const partnerName = isSource ? rel.target_name : rel.source_name
                    const { color } = getRelationColor(rel.relation_type)

                    return (
                      <div
                        key={rel.id}
                        style={{
                          border: '1px solid var(--line)',
                          borderRadius: '6px',
                          padding: '8px 10px',
                          background: 'var(--surface)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong>{partnerName}</strong>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: '600',
                                color,
                                border: `1px solid ${color}`,
                                borderRadius: '4px',
                                padding: '1px 5px'
                              }}
                            >
                              {rel.relation_type}
                            </span>
                            {rel.bidirectional ? (
                              <span title="双向互认"><ArrowsLeftRight size={13} className="muted" /></span>
                            ) : (
                              <span title="单向态度"><ArrowRight size={13} className="muted" /></span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="icon-button"
                            title="删除关系"
                            onClick={() => void handleDeleteRelation(rel.id)}
                            style={{ color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                        {rel.description && (
                          <p className="small muted" style={{ margin: 0, lineHeight: '1.4' }}>
                            {rel.description}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {onSelectEntity && (
                <Button
                  variant="ghost"
                  onClick={() => onSelectEntity(selectedEntity)}
                  style={{ marginTop: '8px', width: '100%' }}
                >
                  查看该人物详细设定
                </Button>
              )}
            </aside>
          )}
        </div>
      )}

      {/* Create / Edit Relation Dialog */}
      {dialogOpen && (
        <RelationDialog
          novelId={novelId}
          characters={characters}
          initialSourceId={selectedEntityId || characters[0]?.id}
          relation={editingRelation}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            setDialogOpen(false)
            void cache.invalidateQueries({ queryKey: ['relations', novelId] })
          }}
        />
      )}
    </div>
  )
}

function RelationDialog({
  novelId,
  characters,
  initialSourceId,
  relation,
  onClose,
  onSaved
}: {
  novelId: string
  characters: Entity[]
  initialSourceId?: string
  relation: Relation | null
  onClose: () => void
  onSaved: () => void
}) {
  const [sourceId, setSourceId] = useState(relation?.source_id || initialSourceId || characters[0]?.id || '')
  const [targetId, setTargetId] = useState(
    relation?.target_id || characters.find(c => c.id !== sourceId)?.id || characters[1]?.id || ''
  )
  const [relationType, setRelationType] = useState(relation?.relation_type || '道侣')
  const [description, setDescription] = useState(relation?.description || '')
  const [bidirectional, setBidirectional] = useState(relation ? relation.bidirectional : true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!sourceId || !targetId || sourceId === targetId) {
      setError('请选择两个不同的角色。')
      return
    }
    if (!relationType.trim()) {
      setError('请填写关系类型。')
      return
    }

    setBusy(true)
    setError('')
    try {
      if (relation) {
        await api.editRelation(novelId, relation.id, {
          relation_type: relationType.trim(),
          description: description.trim(),
          bidirectional
        })
      } else {
        const payload: RelationInput = {
          source_id: sourceId,
          target_id: targetId,
          relation_type: relationType.trim(),
          description: description.trim(),
          bidirectional
        }
        await api.createRelation(novelId, payload)
      }
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const targetOptions = characters.filter(c => c.id !== sourceId)

  return (
    <Modal
      open
      onOpenChange={v => !v && onClose()}
      title={relation ? '编辑人物关系' : '建立新的人物关系'}
      description="在两人之间建立羁绊约束。当两人同场登场时，系统将自动将该关系作为防OOC基线注入模型提示词。"
    >
      <form
        onSubmit={e => {
          e.preventDefault()
          void handleSave()
        }}
        className="form-stack"
      >
        <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Field label="人物 A">
            <select
              value={sourceId}
              onChange={e => {
                setSourceId(e.target.value)
                if (targetId === e.target.value) {
                  const alt = characters.find(c => c.id !== e.target.value)
                  if (alt) setTargetId(alt.id)
                }
              }}
              disabled={!!relation}
            >
              {characters.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="人物 B">
            <select
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              disabled={!!relation}
            >
              {targetOptions.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="关系类型" help="可点击快捷标签或直接输入自定义称谓">
          <input
            required
            maxLength={80}
            value={relationType}
            onChange={e => setRelationType(e.target.value)}
            placeholder="例如：道侣、生死仇敌、师徒、同盟"
          />
        </Field>

        <div className="style-preset-row" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {['道侣', '情缘', '生死大敌', '宿敌', '师徒', '护道者', '同门师兄妹', '盟友', '主仆', '血亲同族'].map(preset => (
            <Button
              key={preset}
              type="button"
              variant="ghost"
              style={{ fontSize: '11px', padding: '3px 7px' }}
              onClick={() => setRelationType(preset)}
            >
              {preset}
            </Button>
          ))}
        </div>

        <Field label="关系与恩怨详情（可选）" help="简短描述二人的过往羁绊、态度或底线，供模型写作时深入把握">
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="例如：青梅竹马，但在宗门变故中产生误会；外表冷漠针锋相对，实则暗中回护。"
          />
        </Field>

        <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            checked={bidirectional}
            onChange={e => setBidirectional(e.target.checked)}
          />
          <span>双向关系（双方互认相同关系定位；如为单向单恋或暗中仇视可取消勾选）</span>
        </label>

        {error && <Notice>{error}</Notice>}

        <div className="modal-actions" style={{ marginTop: '12px' }}>
          <Button type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !sourceId || !targetId || sourceId === targetId}>
            {busy ? '正在保存…' : '保存关系'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
