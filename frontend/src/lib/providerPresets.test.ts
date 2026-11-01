import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS } from './providerPresets'

describe('providerPresets', () => {
  it('keeps service ownership explicit and offers local compatible endpoints', () => {
    const deepseek = PROVIDER_PRESETS.find(p => p.id === 'deepseek')
    expect(deepseek).toBeDefined()
    expect(deepseek?.base_url).toBe('https://api.deepseek.com')
    expect(deepseek?.model).toBe('deepseek-flash')

    const silicon = PROVIDER_PRESETS.find(p => p.id === 'siliconflow')
    expect(silicon).toBeDefined()
    expect(silicon?.base_url).toBe('https://api.siliconflow.cn/v1')

    const qwen = PROVIDER_PRESETS.find(p => p.id === 'qwen')
    expect(qwen).toBeDefined()
    expect(qwen?.base_url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')

    const kimi = PROVIDER_PRESETS.find(p => p.id === 'moonshot')
    expect(kimi).toBeDefined()
    expect(kimi?.base_url).toBe('https://api.moonshot.cn/v1')
    expect(PROVIDER_PRESETS.find(p => p.id === 'openrouter')?.label).toContain('第三方')

    const ollama = PROVIDER_PRESETS.find(p => p.id === 'ollama-local')
    expect(ollama).toBeDefined()
    expect(ollama?.base_url).toBe('http://127.0.0.1:11434/v1')
  })

  it('every preset has valid parameters', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.name).toBeTruthy()
      expect(preset.base_url).toMatch(/^https?:\/\//)
      expect(preset.docs_url).toMatch(/^https:\/\//)
      expect(preset.context_window).toBeGreaterThan(0)
      expect(preset.max_output_tokens).toBeGreaterThan(0)
      expect(['CNY', 'USD']).toContain(preset.currency)
      expect(preset.input_price).toBeNull()
      expect(preset.output_price).toBeNull()
      expect(preset.price_date).toBeNull()
    }
  })
})
