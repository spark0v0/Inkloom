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
  const key = `${workspaceId}:${novelId}:${chapterId}`
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>('saved')
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState<Version | null>(null)
  const [recovery, setRecovery] = useState<RecoveryDraft | null>(null)
  const [localText, setLocalText] = useState(initial.text)
  const [savedAt, setSavedAt] = useState(initial.created_at)

  const persistRecovery = useCallback(async () => {
    try {
      await drafts.put({ key, baseVersion: base.current.id, ...current.current, updatedAt: new Date().toISOString() })
    } catch {
      if (alive.current) setMessage('浏览器恢复副本不可用。请保持页面打开，确认工作区保存成功或下载草稿。')
    }
  }, [key])

  const flush = useCallback((): Promise<Version> => {
    if (composing.current) return Promise.reject(new Error('请先完成当前中文输入，再执行此操作。'))
    clearTimeout(timer.current)
    if (inFlight.current) return inFlight.current
    const run = async () => {
      try {
        while (pending.current || signature(current.current) !== saved.current) {
          if (!pending.current) pending.current = { base_version_id: base.current.id, operation_id: uuid(), text: current.current.text, editor_doc: current.current.doc }
          const body = pending.current
          if (alive.current) { setStatus('saving'); setMessage('') }
          const version = await api.save(novelId, chapterId, body)
          base.current = version
          saved.current = signature({ text: body.text, doc: body.editor_doc! })
          pending.current = null
          onCommitRef.current(version)
          if (alive.current) setSavedAt(version.created_at)
          if (composing.current) break
        }
        if (signature(current.current) === saved.current && !pending.current) {
          await drafts.remove(key).catch(() => undefined)
          if (signature(current.current) === saved.current && !pending.current) {
            if (alive.current) { setStatus('saved'); setMessage('') }
          } else {
            await persistRecovery()
            if (alive.current) setStatus('dirty')
          }
        } else if (alive.current) setStatus('dirty')
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
  }, [chapterId, key, novelId, persistRecovery])

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

  const accept = useCallback((version: Version) => {
    base.current = version
    current.current = { text: version.text, doc: version.editor_doc }
    saved.current = signature(current.current)
    pending.current = null
    setLocalText(version.text); setSavedAt(version.created_at); setStatus('saved'); setMessage(''); setConflict(null)
    void drafts.remove(key).catch(() => undefined)
    onCommitRef.current(version)
  }, [key])

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
    void drafts.get(key).then(value => {
      if (value && signature(value) !== saved.current && (value.text !== initial.text || JSON.stringify(value.doc) !== JSON.stringify(initial.editor_doc)) && alive.current) setRecovery(value)
    }).catch(() => { if (alive.current) setMessage('浏览器恢复存储不可用，工作区保存仍可使用。') })
    const unload = (event: BeforeUnloadEvent) => {
      if (pending.current || signature(current.current) !== saved.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', unload)
    return () => { alive.current = false; clearTimeout(timer.current); window.removeEventListener('beforeunload', unload) }
  }, [key, initial])

  return { status, message, conflict, recovery, setRecovery, localText, savedAt, base, current, flush, change, accept, rebase, composing }
}
