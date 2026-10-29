import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { ApiError, api, errorText, uuid } from './api'
import type { Version } from './api'
import { drafts } from './drafts'
import type { RecoveryDraft } from './drafts'

export type Buffer = { text: string; doc: JSONContent }
const signature = (value: Buffer) => JSON.stringify(value)

/** The acknowledged version is authoritative; IndexedDB only holds recovery copies. */
export function useManuscript(novelId: string, chapterId: string, workspaceId: string, initial: Version, onCommit: (v: Version) => void) {
  const base = useRef(initial)
  const current = useRef<Buffer>({ text: initial.text, doc: initial.editor_doc })
  const saved = useRef(signature(current.current))
  const pending = useRef<Parameters<typeof api.save>[2] | null>(null)
  const inFlight = useRef<Promise<Version> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const composing = useRef(false)
  const alive = useRef(true)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const [editorId] = useState(uuid)
  const legacyKey = `${workspaceId}:${novelId}:${chapterId}`
  const prefix = legacyKey + ':'
  const key = prefix + editorId
  const recoveryQueue = useRef<Promise<unknown>>(Promise.resolve())
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>('saved')
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState<Version | null>(null)
  const [recoveries, setRecoveries] = useState<RecoveryDraft[]>([])
  const [localText, setLocalText] = useState(initial.text)
  const [savedAt, setSavedAt] = useState(initial.created_at)

  const queueRecovery = useCallback((action: () => Promise<unknown>) => {
    const task = recoveryQueue.current.catch(() => undefined).then(action)
    recoveryQueue.current = task
    return task
  }, [])

  const persistRecovery = useCallback(async () => {
    const snapshot = { key, baseVersion: base.current.id, ...current.current, updatedAt: new Date().toISOString() }
    try {
      await queueRecovery(() => drafts.put(snapshot))
    } catch {
      if (alive.current) setMessage('浏览器恢复副本不可用。请保持页面打开，确认工作区保存成功或下载草稿。')
    }
  }, [key, queueRecovery])

  const flush = useCallback((): Promise<Version> => {
    if (!alive.current) return Promise.reject(new Error('页面已切换，草稿保留在原工作区的浏览器恢复副本。'))
    if (composing.current) return Promise.reject(new Error('请先完成当前中文输入，再执行此操作。'))
    clearTimeout(timer.current)
    if (inFlight.current) return inFlight.current
    const run = async () => {
      try {
        while (pending.current || signature(current.current) !== saved.current) {
          if (!alive.current) throw new Error('页面已切换，未继续保存原页面的草稿。')
          if (!pending.current) pending.current = { base_version_id: base.current.id, operation_id: uuid(), text: current.current.text, editor_doc: current.current.doc }
          const body = pending.current
          if (alive.current) { setStatus('saving'); setMessage('') }
          const version = await api.save(novelId, chapterId, body, workspaceId)
          base.current = version
          saved.current = signature({ text: body.text, doc: body.editor_doc! })
          pending.current = null
          onCommitRef.current(version)
          if (alive.current) setSavedAt(version.created_at)
          if (composing.current) break
        }
        if (signature(current.current) === saved.current && !pending.current) {
          await queueRecovery(() => drafts.remove(key)).catch(() => undefined)
          if (signature(current.current) === saved.current && !pending.current) {
            if (alive.current) { setStatus('saved'); setMessage('') }
          } else {
            await persistRecovery()
            if (alive.current) setStatus('dirty')
          }
        } else if (alive.current) setStatus('dirty')
        if (!alive.current) throw new Error('页面已切换，未继续执行原页面的操作。')
        return base.current
      } catch (error) {
        await persistRecovery()
        if (alive.current) {
          setMessage(errorText(error)); setStatus(error instanceof ApiError && error.code === 'VERSION_CONFLICT' ? 'conflict' : 'error')
          if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
            const remote = await api.chapter(novelId, chapterId).catch(() => null)
            if (remote && alive.current) setConflict(remote.version)
          }
        }
        throw error
      } finally { inFlight.current = null }
    }
    inFlight.current = run()
    return inFlight.current
  }, [chapterId, key, novelId, persistRecovery, queueRecovery, workspaceId])

  const change = useCallback((value: Buffer) => {
    current.current = value
    setLocalText(value.text)
    const dirty = signature(value) !== saved.current || !!pending.current
    setStatus(previous => previous === 'conflict' ? previous : dirty ? 'dirty' : 'saved')
    clearTimeout(timer.current)
    if (dirty) {
      void persistRecovery()
      if (!composing.current) timer.current = setTimeout(() => { void flush().catch(() => undefined) }, 900)
    }
  }, [flush, persistRecovery])

  const accept = useCallback((version: Version, expected?: Version) => {
    if (!alive.current) return false
    if (expected && (composing.current || signature(current.current) !== signature({ text: expected.text, doc: expected.editor_doc }))) {
      clearTimeout(timer.current)
      setConflict(version); setStatus('conflict'); setMessage('操作期间正文又有修改，已保留本页输入，请比较工作区版本。')
      void persistRecovery()
      onCommitRef.current(version)
      return false
    }
    base.current = version
    current.current = { text: version.text, doc: version.editor_doc }
    saved.current = signature(current.current)
    pending.current = null
    setLocalText(version.text); setSavedAt(version.created_at); setStatus('saved'); setMessage(''); setConflict(null)
    void queueRecovery(() => drafts.remove(key)).catch(() => undefined)
    onCommitRef.current(version)
    return true
  }, [key, persistRecovery, queueRecovery])

  const dismissRecovery = useCallback((value: RecoveryDraft) => {
    setRecoveries(previous => previous.filter(item => item.key !== value.key))
  }, [])
  const consumeRecovery = useCallback(async (value: RecoveryDraft) => {
    const removed = await drafts.removeIfUnchanged(value)
    if (!alive.current) return
    if (removed) dismissRecovery(value)
    else {
      const latest = await drafts.get(value.key)
      if (alive.current) setRecoveries(previous => latest ? previous.map(item => item.key === value.key ? latest : item) : previous.filter(item => item.key !== value.key))
    }
  }, [dismissRecovery])

  const rebase = useCallback(async () => {
    if (!conflict) return
    base.current = conflict
    saved.current = signature({ text: conflict.text, doc: conflict.editor_doc })
    pending.current = null
    setConflict(null)
    return flush()
  }, [conflict, flush])

  useEffect(() => {
    alive.current = true
    void Promise.all([drafts.get(legacyKey), drafts.list(prefix)]).then(([legacy, values]) => {
      const copies = [...(legacy ? [legacy] : []), ...values].filter(value => value.key !== key &&
        (value.text !== initial.text || JSON.stringify(value.doc) !== JSON.stringify(initial.editor_doc)))
      if (alive.current) setRecoveries(copies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    }).catch(() => { if (alive.current) setMessage('浏览器恢复存储不可用，工作区保存仍可使用。') })
    const unload = (event: BeforeUnloadEvent) => {
      if (pending.current || signature(current.current) !== saved.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', unload)
    return () => { alive.current = false; clearTimeout(timer.current); window.removeEventListener('beforeunload', unload) }
  }, [key, legacyKey, prefix, initial])

  return { status, message, conflict, recoveries, dismissRecovery, consumeRecovery, localText, savedAt, base, current, flush, change, accept, rebase, composing }
}
