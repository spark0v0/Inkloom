/** Connection starters, not model rankings or a live price catalog. */
export interface ProviderPreset {
  id: string
  label: string
  name: string
  base_url: string
  model: string
  description: string
  docs_url: string
  context_window: number
  max_output_tokens: number
  stream: boolean
  json_mode: boolean
  include_usage: boolean
  token_parameter: 'max_tokens' | 'max_completion_tokens'
  currency: 'CNY' | 'USD'
  input_price: number | null
  output_price: number | null
  price_date: string | null
}

type Service = Pick<ProviderPreset, 'id' | 'label' | 'name' | 'base_url' | 'description' | 'docs_url'> & Partial<ProviderPreset>
const starter = (service: Service): ProviderPreset => ({
  model: '', context_window: 32000, max_output_tokens: 8000,
  stream: true, json_mode: false, include_usage: false, token_parameter: 'max_tokens',
  currency: 'CNY', input_price: null, output_price: null, price_date: null,
  ...service,
})

// The generic limits are editable starting budgets, not advertised model specifications.
// Verify the selected model in its service catalog. Do not invent a price confirmation date.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  starter({
    id: 'deepseek', label: 'DeepSeek 官方', name: 'DeepSeek',
    base_url: 'https://api.deepseek.com', model: 'deepseek-flash',
    description: '填写官方兼容接口。请核对账号可用模型与容量；价格可能分时段，默认保持未知。',
    docs_url: 'https://api-docs.deepseek.com/quick_start/pricing/',
  }),
  starter({
    id: 'siliconflow', label: '硅基流动', name: '硅基流动',
    base_url: 'https://api.siliconflow.cn/v1',
    description: '此连接发送给硅基流动。填写该服务提供的精确模型 ID，再按模型文档调整容量。',
    docs_url: 'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions',
  }),
  starter({
    id: 'qwen', label: '阿里云百炼（北京地域）', name: '阿里云百炼',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus',
    description: '使用百炼兼容接口；其他地域需更换地址。请按所选模型确认容量、输出上限和协议选项。',
    docs_url: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
  }),
  starter({
    id: 'moonshot', label: '月之暗面 Kimi', name: '月之暗面 Kimi',
    base_url: 'https://api.moonshot.cn/v1',
    description: '填写 Kimi 开放平台中当前可用的模型 ID；订阅账号与 API 服务的权限和费用分开。',
    docs_url: 'https://platform.moonshot.cn/docs/guide/start-using-kimi-api',
  }),
  starter({
    id: 'openrouter', label: 'OpenRouter（第三方模型服务）', name: 'OpenRouter',
    base_url: 'https://openrouter.ai/api/v1', currency: 'USD',
    description: '请求交给 OpenRouter 及其模型供应商。请从该服务目录选择模型，不沿用模型厂商的密钥。',
    docs_url: 'https://openrouter.ai/docs/quickstart',
  }),
  starter({
    id: 'ollama-local', label: '本机 Ollama', name: '本机 Ollama',
    base_url: 'http://127.0.0.1:11434/v1',
    description: '先启动本机服务并安装模型，再填写模型 ID 和实际加载的上下文容量。无鉴权服务可留空密钥；本机服务也可能代理云模型。',
    docs_url: 'https://docs.ollama.com/api/openai-compatibility',
  }),
  starter({
    id: 'lmstudio-local', label: '本机 LM Studio', name: '本机 LM Studio',
    base_url: 'http://127.0.0.1:1234/v1',
    description: '先在 LM Studio 启动兼容服务并加载模型，填写该服务的模型 ID 和容量；如启用鉴权仍需密钥。',
    docs_url: 'https://lmstudio.ai/docs/developer/openai-compat',
  }),
]
