import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { ArrowClockwise, ArrowCounterClockwise, TextB, TextItalic } from '@phosphor-icons/react'

export function ManuscriptTools({ editor, composing }: { editor: Editor | null; composing: boolean }) {
  const state = useEditorState({ editor, selector: ({ editor }) => ({
    bold: editor?.isActive('bold') ?? false,
    italic: editor?.isActive('italic') ?? false,
    undo: editor?.can().undo() ?? false,
    redo: editor?.can().redo() ?? false,
  }) })
  const disabled = !editor || composing
  function run(command: 'bold' | 'italic' | 'undo' | 'redo') {
    if (!editor || composing || editor.view.composing) return
    const chain = editor.chain().focus()
    if (command === 'bold') chain.toggleBold().run()
    else if (command === 'italic') chain.toggleItalic().run()
    else chain[command]().run()
  }
  return <div className="manuscript-tools" role="group" aria-label="正文格式">
    <button className="icon-button" title="加粗（Ctrl / ⌘ B）" aria-label="加粗" aria-pressed={state?.bold ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => run('bold')}><TextB size={18} /></button>
    <button className="icon-button" title="斜体（Ctrl / ⌘ I）" aria-label="斜体" aria-pressed={state?.italic ?? false} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => run('italic')}><TextItalic size={18} /></button>
    <button className="icon-button" title="撤销（Ctrl / ⌘ Z）" aria-label="撤销" disabled={disabled || !state?.undo} onMouseDown={e => e.preventDefault()} onClick={() => run('undo')}><ArrowCounterClockwise size={17} /></button>
    <button className="icon-button" title="重做（Ctrl / ⌘ Shift Z）" aria-label="重做" disabled={disabled || !state?.redo} onMouseDown={e => e.preventDefault()} onClick={() => run('redo')}><ArrowClockwise size={17} /></button>
  </div>
}
