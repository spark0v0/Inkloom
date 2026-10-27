import type { Provider } from '../lib/api'

export function ProviderDisclosure({ provider }: { provider?: Provider }) {
  return <p className={`model-disclosure ${provider?.kind === 'demo' ? 'is-demo' : ''}`}>{provider?.kind === 'demo' ? '演示模式：使用固定样例，不调用真实模型。' : !provider?.has_key ? '先在模型设置中填写 API Key。' : `发送至 ${provider.name} · ${provider.model}。${provider.input_price == null ? '费用未知。' : '按配置价格估算费用。'}`}</p>
}
