import type { EntityInput } from './api'

export function parseAliases(text: string): string[] {
  return text.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean)
}

export function entityDraftOf(entity: EntityInput): EntityInput {
  const { kind, name, summary, body, status, aliases = [] } = entity
  return { kind, name, summary, body, status, aliases: [...aliases] }
}

// Only fields unchanged from the original baseline may take a remote update.
// The returned value contains writable fields only, never server metadata.
export function rebaseEntityDraft(current: EntityInput, base: EntityInput, latest: EntityInput): EntityInput {
  return {
    kind: current.kind === base.kind ? latest.kind : current.kind,
    name: current.name === base.name ? latest.name : current.name,
    summary: current.summary === base.summary ? latest.summary : current.summary,
    body: current.body === base.body ? latest.body : current.body,
    status: current.status === base.status ? latest.status : current.status,
    aliases: [...(JSON.stringify(current.aliases ?? []) === JSON.stringify(base.aliases ?? []) ? latest.aliases ?? [] : current.aliases ?? [])],
  }
}
