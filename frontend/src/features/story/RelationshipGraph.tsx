import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Trash,
  User,
  ArrowsLeftRight,
  ArrowRight,
  MagnifyingGlass,
  Sparkle,
  PencilSimple,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowCounterClockwise,
  Heart,
  Sword,
  GraduationCap,
  Users
} from '@phosphor-icons/react'
import { api, ApiError, errorText } from '../../lib/api'
import type { Entity, Relation, RelationInput } from '../../lib/api'
import { Badge, Button, Empty, Field, Loading, Modal, Notice } from '../../components/ui'

export const PRESET_RELATIONS = [
  { label: '道侣 / 情缘', category: '情感', color: '#be185d', bg: 'rgba(236, 72, 153, 0.12)' },
  { label: '生死大敌 / 仇怨', category: '对立', color: '#e11d48', bg: 'rgba(225, 29, 72, 0.12)' },
  { label: '师徒 / 护道者', category: '传授', color: '#0f766e', bg: 'rgba(15, 118, 110, 0.12)' },
  { label: '同门师兄弟', category: '门派', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)' },
  { label: '盟友 / 合作者', category: '互利', color: '#0f766e', bg: 'rgba(13, 148, 136, 0.12)' },
  { label: '主仆 / 契约灵兽', category: '从属', color: '#475569', bg: 'rgba(100, 116, 139, 0.12)' },
  { label: '同族 / 血亲', category: '血脉', color: '#92400e', bg: 'rgba(217, 119, 6, 0.12)' },
  { label: '知己 / 结义', category: '情义', color: '#6d28d9', bg: 'rgba(139, 92, 246, 0.12)' }
]

export function getRelationColor(type: string): { color: string; bg: string } {
  const found = PRESET_RELATIONS.find(p => p.label.includes(type) || type.includes(p.label.split(' / ')[0]))
  if (found) return found
  if (type.includes('敌') || type.includes('仇') || type.includes('杀') || type.includes('怨') || type.includes('逆')) {
    return { color: '#e11d48', bg: 'rgba(225, 29, 72, 0.12)' }
  }
  if (type.includes('情') || type.includes('侣') || type.includes('妻') || type.includes('夫') || type.includes('红颜') || type.includes('恋')) {
    return { color: '#be185d', bg: 'rgba(236, 72, 153, 0.12)' }
  }
  if (type.includes('师') || type.includes('徒') || type.includes('长辈') || type.includes('尊')) {
    return { color: '#0f766e', bg: 'rgba(15, 118, 110, 0.12)' }
  }
  if (type.includes('兄') || type.includes('弟') || type.includes('门') || type.includes('友') || type.includes('朋')) {
    return { color: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)' }
  }
  if (type.includes('主') || type.includes('仆') || type.includes('兽') || type.includes('奴')) {
    return { color: '#475569', bg: 'rgba(100, 116, 139, 0.12)' }
  }
  if (type.includes('族') || type.includes('血') || type.includes('亲') || type.includes('子') || type.includes('父') || type.includes('母')) {
    return { color: '#92400e', bg: 'rgba(217, 119, 6, 0.12)' }
  }
  return { color: '#0f766e', bg: 'rgba(13, 148, 136, 0.12)' }
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
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState<number>(1.0)
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
        const match =
          r.source_name.toLowerCase().includes(q) ||
          r.target_name.toLowerCase().includes(q) ||
          r.relation_type.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
        if (!match) return false
      }
      return true
    })
  }, [allRelations, filterType, search])

  // Related entity IDs when one is selected or hovered
  const activeFocusId = selectedEntityId || hoveredEntityId
  const connectedIds = useMemo(() => {
    if (!activeFocusId) return new Set<string>()
    const set = new Set<string>([activeFocusId])
    for (const r of allRelations) {
      if (r.source_id === activeFocusId) set.add(r.target_id)
      if (r.target_id === activeFocusId && r.bidirectional) set.add(r.source_id)
      if (r.target_id === activeFocusId && !r.bidirectional) set.add(r.source_id)
    }
    return set
  }, [activeFocusId, allRelations])

  // Selected character's direct relations
  const selectedCharacterRelations = useMemo(() => {
    if (!selectedEntityId) return []
    return visibleRelations.filter(
      r => r.source_id === selectedEntityId || r.target_id === selectedEntityId
    )
  }, [selectedEntityId, visibleRelations])

  // Adaptive Node layout calculation
  // For small sets (<= 8), use single ring.
  // For larger sets, use dual concentric rings to avoid edge/label crowding.
  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    const count = characters.length
    if (count === 0) return map

    const cx = 450
    const cy = 270

    if (count <= 8) {
      const rx = 320
      const ry = 190
      characters.forEach((char, idx) => {
        const angle = (idx / count) * 2 * Math.PI - Math.PI / 2
        const x = cx + rx * Math.cos(angle)
        const y = cy + ry * Math.sin(angle)
        map.set(char.id, { x: Math.round(x), y: Math.round(y) })
      })
    } else {
      // Dual ring layout
      const innerCount = Math.min(6, Math.ceil(count / 3))
      const outerCount = count - innerCount

      const innerRx = 180
      const innerRy = 110
      const outerRx = 360
      const outerRy = 220

      // Inner ring (first innerCount characters)
      for (let i = 0; i < innerCount; i++) {
        const char = characters[i]
        const angle = (i / innerCount) * 2 * Math.PI - Math.PI / 2
        const x = cx + innerRx * Math.cos(angle)
        const y = cy + innerRy * Math.sin(angle)
        map.set(char.id, { x: Math.round(x), y: Math.round(y) })
      }

      // Outer ring (remaining characters, offset angle to stagger)
      const angleOffset = Math.PI / outerCount
      for (let i = 0; i < outerCount; i++) {
        const char = characters[innerCount + i]
        const angle = (i / outerCount) * 2 * Math.PI - Math.PI / 2 + angleOffset
        const x = cx + outerRx * Math.cos(angle)
        const y = cy + outerRy * Math.sin(angle)
        map.set(char.id, { x: Math.round(x), y: Math.round(y) })
      }
    }

    return map
  }, [characters])

  async function handleDeleteRelation(relation: Relation) {
    if (!confirm('确定要删除这条人物关系吗？')) return
    try {
      await api.deleteRelation(novelId, relation.id, relation.updated_at)
      await cache.invalidateQueries({ queryKey: ['relations', novelId] })
    } catch (e) {
      setError(errorText(e))
      if (e instanceof ApiError && e.code === 'RELATION_CONFLICT') void relationsQuery.refetch()
    }
  }

  function handleEditRelation(rel: Relation) {
    setEditingRelation(rel)
    setDialogOpen(true)
  }

  const selectedEntity = characters.find(c => c.id === selectedEntityId)
  const hoveredEntity = characters.find(c => c.id === hoveredEntityId)

  return (
    <div className="relationship-graph-container form-stack" style={{ gap: '16px' }}>
      {/* Search & Filter Toolbar */}
      <div className="section-toolbar" style={{ gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '240px' }}>
          <label className="search-input" style={{ flex: 1 }}>
            <MagnifyingGlass size={17} />
            <input
              placeholder="搜索角色名、羁绊类型或恩怨描述…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="搜索关系图谱"
            />
          </label>
        </div>

        <label className="graph-character-picker">查看人物关系<select aria-label="查看人物关系" value={selectedEntityId || ''} onChange={event => setSelectedEntityId(event.target.value || null)}><option value="">全书人物</option>{characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="filter-pills" role="group" aria-label="关系筛选" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <Button
            type="button"
            variant={filterType === 'all' ? 'primary' : 'ghost'}
            aria-pressed={filterType === 'all'}
            onClick={() => setFilterType('all')}
            style={{ fontSize: '12px', padding: '4px 9px' }}
          >
            全部关系 ({allRelations.length})
          </Button>
          {[
            { label: '道侣', key: '道侣' },
            { label: '敌对', key: '敌' },
            { label: '师徒', key: '师' },
            { label: '同门', key: '门' },
            { label: '盟友', key: '盟' },
            { label: '从属', key: '仆' }
          ].map(item => (
            <Button
              key={item.key}
              type="button"
              variant={filterType === item.key ? 'primary' : 'ghost'}
              aria-pressed={filterType === item.key}
              onClick={() => setFilterType(item.key)}
              style={{ fontSize: '12px', padding: '4px 9px' }}
            >
              {item.label}
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
      {!selectedEntityId && <p className="graph-mobile-hint small muted">选择人物，查看和编辑相关关系。</p>}

      {entitiesQuery.isPending || relationsQuery.isPending ? (
        <Loading />
      ) : entitiesQuery.error || relationsQuery.error ? (
        <Notice action={<Button onClick={() => { void entitiesQuery.refetch(); void relationsQuery.refetch() }}>重试读取</Button>}>{errorText(entitiesQuery.error || relationsQuery.error)}</Notice>
      ) : characters.length < 2 ? (
        <Empty
          icon={<User size={32} weight="light" />}
          title="需要至少两位角色"
        >
          在“人物”标签中先录入主角与核心配角，随后可在此绘制全书人物羁绊与敌友关系图谱。
        </Empty>
      ) : (
        <div
          className="graph-workspace-layout"
          style={{
            display: 'grid',
            gridTemplateColumns: selectedEntity ? 'minmax(0, 1fr) 320px' : 'minmax(0, 1fr)',
            gap: '16px',
            alignItems: 'start'
          }}
        >
          {/* SVG Graph Canvas Container */}
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
            {/* Header Status & Tips */}
            <div
              style={{
                position: 'absolute',
                top: '12px',
                left: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                zIndex: 2,
                flexWrap: 'wrap'
              }}
            >
              <Badge tone="green">
                <Sparkle size={14} style={{ marginRight: '3px' }} />
                人物羁绊网 ({characters.length} 角色 · {allRelations.length} 关系)
              </Badge>
              <span className="small muted">
                {selectedEntity
                  ? `聚焦：${selectedEntity.name}（已高亮其一度人脉）`
                  : '点击节点聚焦人际圈；点击连线胶囊直接编辑'}
              </span>
            </div>

            {/* Canvas Zoom & View Controls */}
            <div
              className="canvas-view-controls"
              style={{
                position: 'absolute',
                top: '12px',
                right: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                zIndex: 2,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: '6px',
                padding: '2px'
              }}
            >
              <button
                type="button"
                className="icon-button"
                title="放大图谱"
                onClick={() => setZoom(z => Math.min(1.5, Math.round((z + 0.1) * 10) / 10))}
                style={{ width: '28px', height: '28px' }}
              >
                <MagnifyingGlassPlus size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="缩小图谱"
                onClick={() => setZoom(z => Math.max(0.7, Math.round((z - 0.1) * 10) / 10))}
                style={{ width: '28px', height: '28px' }}
              >
                <MagnifyingGlassMinus size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="重置缩放与聚焦"
                onClick={() => {
                  setZoom(1.0)
                  setSelectedEntityId(null)
                }}
                style={{ width: '28px', height: '28px', fontSize: '11px' }}
              >
                <ArrowCounterClockwise size={15} />
              </button>
              <span className="small muted" style={{ padding: '0 6px', fontSize: '11px', userSelect: 'none' }}>
                {Math.round(zoom * 100)}%
              </span>
            </div>

            {/* SVG Canvas */}
            <svg
              viewBox="0 0 900 540"
              style={{
                width: '100%',
                height: 'auto',
                minHeight: '480px',
                display: 'block',
                transform: `scale(${zoom})`,
                transformOrigin: 'center center',
                transition: 'transform 0.2s ease-out'
              }}
              onClick={e => {
                if (e.target === e.currentTarget) setSelectedEntityId(null)
              }}
            >
              <defs>
                <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.08" />
                </filter>
                <filter id="node-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="var(--accent)" floodOpacity="0.4" />
                </filter>
              </defs>

              {/* Background click listener */}
              <rect
                x="0"
                y="0"
                width="900"
                height="540"
                fill="transparent"
                onClick={() => setSelectedEntityId(null)}
              />

              {/* Relationship Lines */}
              {visibleRelations.map(rel => {
                const p1 = nodePositions.get(rel.source_id)
                const p2 = nodePositions.get(rel.target_id)
                if (!p1 || !p2) return null

                const isConnectedToFocus = activeFocusId
                  ? rel.source_id === activeFocusId || rel.target_id === activeFocusId
                  : true

                const isDirectlySelected = selectedEntityId
                  ? rel.source_id === selectedEntityId || (rel.target_id === selectedEntityId && rel.bidirectional)
                  : false

                const { color } = getRelationColor(rel.relation_type)

                const midX = (p1.x + p2.x) / 2
                const midY = (p1.y + p2.y) / 2

                return (
                  <g
                    key={rel.id}
                    opacity={isConnectedToFocus ? 1 : 0.12}
                    style={{ transition: 'opacity 0.25s ease' }}
                  >
                    {/* Line */}
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={color}
                      strokeWidth={isDirectlySelected ? 2.8 : isConnectedToFocus ? 1.8 : 1.2}
                      strokeDasharray={rel.bidirectional ? undefined : '5 3'}
                    />

                    {/* Interactive Relation Badge Pill */}
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={`编辑关系：${rel.source_name}到${rel.target_name}，${rel.relation_type}`}
                      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleEditRelation(rel) } }}
                      transform={`translate(${midX}, ${midY})`}
                      style={{ cursor: 'pointer' }}
                      onClick={e => {
                        e.stopPropagation()
                        setSelectedEntityId(rel.source_id)
                        handleEditRelation(rel)
                      }}
                    >
                      <rect
                        x="-36"
                        y="-11"
                        width="72"
                        height="22"
                        rx="11"
                        fill="var(--paper)"
                        stroke={color}
                        strokeWidth={isDirectlySelected ? '2' : '1'}
                        filter="url(#node-shadow)"
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="11"
                        fill={color}
                        fontWeight="600"
                      >
                        {rel.relation_type.slice(0, 6)}
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
                const isHovered = hoveredEntityId === char.id
                const isConnected = activeFocusId ? connectedIds.has(char.id) : true

                // Calculate connection count for this character
                const relCount = allRelations.filter(
                  r => r.source_id === char.id || r.target_id === char.id
                ).length

                return (
                  <g
                    key={char.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`查看人物关系：${char.name}`}
                    aria-pressed={isSelected}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedEntityId(current => current === char.id ? null : char.id) } }}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
                    opacity={isConnected ? 1 : 0.2}
                    onMouseEnter={() => setHoveredEntityId(char.id)}
                    onMouseLeave={() => setHoveredEntityId(null)}
                    onClick={e => {
                      e.stopPropagation()
                      setSelectedEntityId(current => (current === char.id ? null : char.id))
                    }}
                  >
                    {/* Outer ring on hover/selected */}
                    {(isSelected || isHovered) && (
                      <circle
                        r={isSelected ? 32 : 28}
                        fill="none"
                        stroke={isSelected ? 'var(--accent)' : 'var(--line)'}
                        strokeWidth={2}
                        strokeDasharray={isSelected ? undefined : '4 2'}
                        opacity={0.7}
                      />
                    )}

                    {/* Main Avatar Circle */}
                    <circle
                      r={isSelected ? 26 : 22}
                      fill={isSelected ? 'var(--accent)' : 'var(--paper)'}
                      stroke={isSelected ? 'var(--accent-hover)' : 'var(--line)'}
                      strokeWidth={isSelected ? 3 : 2}
                      filter={isSelected ? 'url(#node-glow)' : 'url(#node-shadow)'}
                    />

                    {/* Character Avatar Initial */}
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="14"
                      fontWeight="bold"
                      fill={isSelected ? '#ffffff' : 'var(--ink)'}
                    >
                      {char.name.slice(0, 1)}
                    </text>

                    {/* Character Name Tag */}
                    <text
                      textAnchor="middle"
                      y={34}
                      fontSize="12"
                      fontWeight={isSelected ? 'bold' : '500'}
                      fill="var(--ink)"
                    >
                      {char.name}
                    </text>

                    {/* Mini connection badge */}
                    {relCount > 0 && (
                      <g transform="translate(16, -14)">
                        <circle r="8" fill="var(--surface)" stroke="var(--line)" strokeWidth="1" />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize="9"
                          fill="var(--muted)"
                          fontWeight="600"
                        >
                          {relCount}
                        </text>
                      </g>
                    )}
                  </g>
                )
              })}

              {/* Tooltip Overlay when hovering on node */}
              {hoveredEntity && !selectedEntityId && nodePositions.has(hoveredEntity.id) && (
                (() => {
                  const p = nodePositions.get(hoveredEntity.id)!
                  const tipY = p.y < 100 ? p.y + 55 : p.y - 55
                  return (
                    <g transform={`translate(${p.x}, ${tipY})`} pointerEvents="none">
                      <rect
                        x="-100"
                        y="-26"
                        width="200"
                        height="52"
                        rx="6"
                        fill="var(--surface)"
                        stroke="var(--line)"
                        strokeWidth="1"
                        filter="url(#node-shadow)"
                      />
                      <text
                        textAnchor="middle"
                        y="-8"
                        fontSize="12"
                        fontWeight="bold"
                        fill="var(--ink)"
                      >
                        {hoveredEntity.name}
                      </text>
                      <text
                        textAnchor="middle"
                        y="12"
                        fontSize="10"
                        fill="var(--muted)"
                      >
                        {hoveredEntity.summary
                          ? hoveredEntity.summary.slice(0, 16) + (hoveredEntity.summary.length > 16 ? '…' : '')
                          : '点击查看一度人际关系'}
                      </text>
                    </g>
                  )
                })()
              )}
            </svg>
          </div>

          {/* Side Inspector when character is selected */}
          {selectedEntity && (
            <aside
              className="selected-character-inspector form-stack"
              style={{
                border: '1px solid var(--line)',
                borderRadius: '8px',
                padding: '16px',
                background: 'var(--paper)',
                maxHeight: '520px',
                overflowY: 'auto',
                boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
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
                  清除聚焦
                </Button>
              </div>

              {selectedEntity.summary && (
                <p className="small muted" style={{ margin: '4px 0 8px', lineHeight: '1.5' }}>
                  {selectedEntity.summary}
                </p>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderTop: '1px solid var(--line)',
                  paddingTop: '10px'
                }}
              >
                <span className="small">
                  一度人际圈 ({selectedCharacterRelations.length})
                </span>
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
                  该角色暂未建立与他人的羁绊关系线。
                </p>
              ) : (
                <div className="inspector-relations-list form-stack" style={{ gap: '8px' }}>
                  {selectedCharacterRelations.map(rel => {
                    const isSource = rel.source_id === selectedEntity.id
                    const partnerName = isSource ? rel.target_name : rel.source_name
                    const partnerId = isSource ? rel.target_id : rel.source_id
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
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '4px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => setSelectedEntityId(partnerId)}
                              title="点击切换聚焦到此角色"
                              style={{
                                fontWeight: 'bold',
                                color: 'var(--ink)',
                                textDecoration: 'underline',
                                textUnderlineOffset: '2px',
                                padding: 0
                              }}
                            >
                              {partnerName}
                            </button>
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
                              <span title="双向互认">
                                <ArrowsLeftRight size={13} className="muted" />
                              </span>
                            ) : (
                              <span title={`${rel.source_name} → ${rel.target_name}（单向）`}>
                                <ArrowRight size={13} className="muted" style={{ transform: isSource ? undefined : 'rotate(180deg)' }} />
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <button
                              type="button"
                              className="icon-button"
                              title="编辑关系"
                              onClick={() => handleEditRelation(rel)}
                              style={{ color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                            >
                              <PencilSimple size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              title="删除关系"
                              onClick={() => void handleDeleteRelation(rel)}
                              style={{ color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                            >
                              <Trash size={14} />
                            </button>
                          </div>
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
                  查看该人物完整档案
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
          onClose={() => {
            setDialogOpen(false)
            setEditingRelation(null)
          }}
          onSaved={() => {
            setDialogOpen(false)
            setEditingRelation(null)
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
  const [baseline, setBaseline] = useState(relation)
  const [conflicted, setConflicted] = useState(false)
  const [latest, setLatest] = useState<Relation | null>(null)

  async function readLatest() {
    if (!baseline || busy) return
    setBusy(true)
    try {
      const value = (await api.relations(novelId)).find(item => item.id === baseline.id)
      if (!value) throw new Error('这条关系已被删除。你的输入仍保留，可复制后关闭。')
      if (relationType === baseline.relation_type) setRelationType(value.relation_type)
      if (description === baseline.description) setDescription(value.description)
      if (bidirectional === baseline.bidirectional) setBidirectional(value.bidirectional)
      setBaseline(value); setLatest(value); setConflicted(false); setError('')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  async function handleSave() {
    if (busy) return
    if (!sourceId || !targetId || sourceId === targetId) {
      setError('请选择两位不同的角色。')
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
          base_updated_at: baseline!.updated_at,
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
      setConflicted(e instanceof ApiError && e.code === 'RELATION_CONFLICT')
    } finally {
      setBusy(false)
    }
  }

  const targetOptions = characters.filter(c => c.id !== sourceId)

  return (
    <Modal
      open
      dismissible={!busy}
      onOpenChange={v => !v && onClose()}
      title={relation ? '编辑人物关系' : '建立新的人物关系'}
      description="记录两人的关系与方向，供后续写作参考。设定不等于正文中已经发生的事实。"
    >
      <form
        onSubmit={e => {
          e.preventDefault()
          void handleSave()
        }}
        className="form-stack"
      >
        <fieldset disabled={busy} className="relation-fields form-stack">
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

        <div className="preset-categories form-stack" style={{ gap: '6px' }}>
          <span className="small muted">常用网文羁绊预设：</span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { text: '道侣', icon: Heart, color: '#be185d' },
              { text: '情缘 / 伴侣', icon: Heart, color: '#be185d' },
              { text: '生死大敌', icon: Sword, color: '#e11d48' },
              { text: '宿敌 / 对立', icon: Sword, color: '#e11d48' },
              { text: '师尊 / 徒弟', icon: GraduationCap, color: '#0f766e' },
              { text: '护道者', icon: GraduationCap, color: '#0f766e' },
              { text: '同门师兄弟', icon: Users, color: '#2563eb' },
              { text: '生死同盟', icon: Users, color: '#0f766e' },
              { text: '主仆 / 灵兽', icon: Users, color: '#475569' },
              { text: '血亲同族', icon: Users, color: '#92400e' }
            ].map(item => {
              const Icon = item.icon
              return (
                <Button
                  key={item.text}
                  type="button"
                  variant="ghost"
                  style={{
                    fontSize: '11px',
                    padding: '3px 8px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  onClick={() => setRelationType(item.text.split(' / ')[0])}
                >
                  <Icon size={12} color={item.color} />
                  {item.text}
                </Button>
              )
            })}
          </div>
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
          <span>双向关系（双方互认相同关系定位；如为单向暗恋或暗中仇视可取消勾选）</span>
        </label>
        </fieldset>

        {error && <Notice>{error}</Notice>}
        {conflicted && <Button disabled={busy} onClick={() => void readLatest()}>读取最新关系并保留本页修改</Button>}
        {latest && <details><summary>查看当前已保存关系</summary><p>{latest.relation_type} · {latest.bidirectional ? '双向' : '单向'}</p><p>{latest.description || '未填写关系详情'}</p></details>}

        <div className="modal-actions" style={{ marginTop: '12px' }}>
          <Button type="button" disabled={busy} onClick={onClose}>
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
