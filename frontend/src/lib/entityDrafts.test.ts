import { describe, expect, it } from 'vitest'
import { entityDraftOf, parseAliases, rebaseEntityDraft } from './entityDrafts'
import type { EntityInput } from './api'

const base: EntityInput = { kind: 'character', name: '林舟', summary: '旧简述', body: '旧档案', aliases: ['阿舟'], status: 'author' }

describe('entity conflict resolution', () => {
  it('preserves local edits while accepting remote changes to untouched fields', () => {
    const current = { ...base, body: '本页修改', status: 'proposed' as const }
    const latest = { ...base, name: '林舟生', summary: '另一窗口简述', body: '另一窗口档案', aliases: ['阿舟', '舟生'] }
    expect(rebaseEntityDraft(current, base, latest)).toEqual({ ...latest, body: '本页修改', status: 'proposed' })
  })

  it('retains locally changed aliases across another conflict and treats missing aliases as empty', () => {
    const current = { ...base, aliases: parseAliases(' 阿舟， 小舟\n舟生、') }
    const latest = { ...base, summary: '新简述', aliases: ['舟生'] }
    const rebased = rebaseEntityDraft(current, base, latest)
    expect(rebased.aliases).toEqual(['阿舟', '小舟', '舟生'])
    expect(rebaseEntityDraft(rebased, latest, { ...latest, summary: '更新简述' })).toEqual({ ...rebased, summary: '更新简述' })
    expect(rebaseEntityDraft({ ...base, aliases: undefined }, { ...base, aliases: [] }, latest).aliases).toEqual(['舟生'])
  })

  it('never copies read-only metadata into a save request', () => {
    expect(entityDraftOf({ ...base, id: 'server-only', updated_at: 'server-only' } as EntityInput)).toEqual(base)
  })
})
