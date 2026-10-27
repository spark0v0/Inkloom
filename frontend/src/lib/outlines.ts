import type { OutlineDocument, OutlineField } from './api'

export const outlineFields: Record<OutlineField, string> = {
  goal: '本章目标', conflict: '核心冲突', beats: '情节节点', ending_hook: '章末钩子', text: '现有细纲',
}
export const structuredFields: OutlineField[] = ['goal', 'conflict', 'beats', 'ending_hook']
export function outlineValue(document: OutlineDocument, field: OutlineField): string {
  if (document.kind === 'text') return field === 'text' ? document.text : ''
  if (field === 'text') return ''
  const value = document[field] ?? ''
  return Array.isArray(value) ? value.map((item, index) => `${index + 1}. ${item}`).join('\n') : value
}
export const sameOutline = (left: OutlineDocument, right: OutlineDocument) => JSON.stringify(left) === JSON.stringify(right)
export function outlineText(document: OutlineDocument) {
  return document.kind === 'text' ? document.text : structuredFields.map(field => `${outlineFields[field]}：\n${outlineValue(document, field)}`).join('\n\n')
}
