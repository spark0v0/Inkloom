import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { RelationshipGraph } from './RelationshipGraph'

describe('RelationshipGraph Component', () => {
  it('renders graph container and toolbar', () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    })

    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(RelationshipGraph, { novelId: 'test-novel-1' })
      )
    )

    expect(html).toContain('relationship-graph-container')
    expect(html).toContain('全部关系')
    expect(html).toContain('添加关系')
  })
})
