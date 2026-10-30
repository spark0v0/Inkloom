import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './assets/fonts/ui-font.css'
import './styles.css'
import './studio.css'
import './workbench.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10000, refetchOnWindowFocus: false }, mutations: { retry: false } } })
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Do not send manuscripts or keys to telemetry. */ }
  render() { return this.state.failed ? <div className="connection-error"><h1>页面遇到了问题</h1><p>请重新载入页面。工作区已保存的正文不会丢失，浏览器恢复副本也会保留。</p><button className="btn btn-primary" onClick={() => location.reload()}>重新载入</button></div> : this.props.children }
}
createRoot(document.getElementById('root')!).render(<Boundary><QueryClientProvider client={queryClient}><App /></QueryClientProvider></Boundary>)
