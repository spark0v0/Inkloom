import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { JobDetail } from '../lib/api'
import { AttemptHistory, JobResult } from './JobPresentation'

function render(result: NonNullable<JobDetail['result']>) {
  const job = { task: result.kind, result } as JobDetail
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() },
    createElement(JobResult, { job, onEvidence: () => undefined })))
}

describe('任务记录中的结构化规划结果', () => {
  it('可以阅读全书方案，而不是显示空白结果', () => {
    const html = render({ kind: 'blueprint', title: '失踪的账本', logline: '归乡者追查旧案',
      blurb: '一封信让归乡者重新审视过去。', reader_promise: '调查与选择',
      main_conflict: '寻找真相还是保护家人', ending: '公开原始档案', style_guide: '第三人称限知',
      characters: [{ name: '陈序', role: '调查者', motivation: '寻找家人', arc: '学会协作' }],
      world: [{ name: '雾港', rule: '档案不对外公开' }],
      volumes: [{ title: '雨夜归港', summary: '追查来信', climax: '找到日志', ending_hook: '另一封信', planned_chapters: 30 }] })
    expect(html).toContain('失踪的账本')
    expect(html).toContain('一封信让归乡者重新审视过去。')
    expect(html).toContain('雨夜归港')
  })

  it('可以阅读章节细纲与章末钩子', () => {
    const html = render({ kind: 'outline', volume_title: '雨夜归港', chapters: [1, 2, 3].map(number => ({
      number, title: '线索' + number, goal: '找到原始档案', conflict: '证人拒绝开口',
      beats: ['前往码头', '交换信息'], ending_hook: '账本中多了一页' })) })
    expect(html).toContain('雨夜归港')
    expect(html).toContain('线索3')
    expect(html).toContain('账本中多了一页')
  })
})

describe('重试后的历史调用内容', () => {
  it('仍可阅读和下载第一次失败留下的片段', () => {
    const html = renderToStaticMarkup(createElement(AttemptHistory, { currency: 'CNY', attempts: [{
      id: 'attempt-one', number: 1, call_state: 'failed', output_text: '第一稿只写到这里。',
      usage: null, cost: null, error_code: 'INCOMPLETE_OUTPUT', created_at: '', finished_at: '',
    }] }))
    expect(html).toContain('第一稿只写到这里。')
    expect(html).toContain('下载第 1 次内容')
    expect(html).toContain('调用失败')
    expect(html).toContain('费用未知')
  })

  it('把模型返回的 HTML 当文字显示', () => {
    const html = renderToStaticMarkup(createElement(AttemptHistory, { currency: 'CNY', attempts: [{
      id: 'attempt-two', number: 2, call_state: 'completed', output_text: '<script>manuscript()</script>',
      usage: { prompt_tokens: 10, completion_tokens: 20 }, cost: 0, error_code: null, created_at: '', finished_at: '',
    }] }))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
