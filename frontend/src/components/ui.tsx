import * as Dialog from '@radix-ui/react-dialog'
import { WarningCircle, X, CheckCircle, ArrowRight } from '@phosphor-icons/react'
import { cloneElement, isValidElement, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'

export function Button({ children, variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button type="button" className={`btn btn-${variant} ${className}`} {...props}>{children}</button>
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
export function Modal({ open, onOpenChange, title, description, children, wide = false, className = '', dismissible = true }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean; className?: string; dismissible?: boolean
}) {
  const previous = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  if (open && !previous.current) returnFocus.current = document.activeElement as HTMLElement | null
  previous.current = open
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal><Dialog.Overlay className="modal-overlay" />
      <Dialog.Content className={`modal ${wide ? 'modal-wide' : ''} ${className}`} onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus({ preventScroll: true }) } }} onEscapeKeyDown={event => { if (!dismissible) event.preventDefault() }}>
        <div className="modal-heading"><div><Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description ?? '请核对内容后完成操作。'}</Dialog.Description></div>
          {dismissible && <Dialog.Close className="icon-button" aria-label="关闭对话框"><X size={20} /></Dialog.Close>}
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
export function Field({ label, help, children, className = '' }: { label: string; help?: string; children: ReactNode; className?: string }) {
  const id = useId()
  const direct = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)
  return <div className={`field ${className}`}><label className="field-label" htmlFor={direct ? id : undefined}>{label}</label>{direct ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string }>, { id, 'aria-describedby': help ? id + '-help' : undefined }) : children}{help && <span id={id + '-help'} className="field-help">{help}</span>}</div>
}
export function Notice({ children, tone = 'amber', action }: { children: ReactNode; tone?: 'amber' | 'green' | 'neutral'; action?: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === 'amber' ? 'alert' : 'status'}>
    {tone === 'green' ? <CheckCircle size={19} /> : <WarningCircle size={19} />}<div>{children}</div>{action}
  </div>
}
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>
}
export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="text-link" onClick={onClick}>{children}<ArrowRight size={16} /></button>
}
export function Loading({ label = '正在读取工作区…' }: { label?: string }) {
  return <div className="loading-state" role="status"><div className="skeleton skeleton-title" /><div className="skeleton" /><div className="skeleton skeleton-short" /><span>{label}</span></div>
}
