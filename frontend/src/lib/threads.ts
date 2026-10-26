import type { Thread, ThreadProgressInput } from './api'

export const threadStatusNames: Record<Thread['status'], string> = {
  planned: '计划中', planted: '已埋设', advanced: '推进中', resolved: '已回收', needs_review: '待复核',
}
export const threadStageNames: Record<ThreadProgressInput['stage'], string> = {
  planted: '埋设', advanced: '推进', resolved: '回收',
}
