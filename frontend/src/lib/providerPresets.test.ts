import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS } from './providerPresets'

describe('providerPresets', () => {
  it('includes core presets for DeepSeek, SiliconFlow, Qwen, Kimi, Claude, and Local engines', () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(10)

    const deepseek = PROVIDER_PRESETS.find(p => p.id === 'deepseek-chat')
    expect(deepseek).toBeDefined()
    expect(deepseek?.base_url).toBe('https://api.deepseek.com')
    expect(deepseek?.model).toBe('deepseek-chat')
    expect(deepseek?.context_window).toBe(64000)

    const silicon = PROVIDER_PRESETS.find(p => p.id === 'siliconflow-v3')
    expect(silicon).toBeDefined()
    expect(silicon?.base_url).toBe('https://api.siliconflow.cn/v1')

    const qwen = PROVIDER_PRESETS.find(p => p.id === 'qwen-plus')
    expect(qwen).toBeDefined()
    expect(qwen?.base_url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')

    const kimi = PROVIDER_PRESETS.find(p => p.id === 'moonshot-kimi')
    expect(kimi).toBeDefined()
    expect(kimi?.context_window).toBe(128000)

    const claude = PROVIDER_PRESETS.find(p => p.id === 'openrouter-claude-35-sonnet')
    expect(claude).toBeDefined()
    expect(claude?.currency).toBe('USD')

    const ollama = PROVIDER_PRESETS.find(p => p.id === 'ollama-local')
    expect(ollama).toBeDefined()
    expect(ollama?.base_url).toBe('http://localhost:11434/v1')
  })

  it('every preset has valid parameters', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.name).toBeTruthy()
      expect(preset.base_url).toMatch(/^https?:\/\//)
      expect(preset.model).toBeTruthy()
      expect(preset.context_window).toBeGreaterThan(0)
      expect(preset.max_output_tokens).toBeGreaterThan(0)
      expect(['CNY', 'USD']).toContain(preset.currency)
    }
  })
})
