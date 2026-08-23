import { describe, expect, it } from 'vitest'
import { applyVendorTemplate, envKeyChoices, hostFromBaseUrl } from './modelTemplates'
import { emptyModelEntry, prepareModelsForSave } from './models'

describe('applyVendorTemplate', () => {
  it('OpenAI 填 /v1 与共用 OPENAI_API_KEY', () => {
    const m = applyVendorTemplate('m-1', 'openai')
    expect(m.base_url).toBe('https://api.openai.com/v1')
    expect(m.api_backend).toBe('chat_completions')
    expect(m.env_key).toBe('OPENAI_API_KEY')
  })

  it('Anthropic 走 messages 并声明 x-api-key 环境头', () => {
    const m = applyVendorTemplate('m-2', 'anthropic')
    expect(m.api_backend).toBe('messages')
    expect(m.env_http_headers['x-api-key']).toBe('ANTHROPIC_API_KEY')
    expect(m.extra_headers['anthropic-version']).toBe('2023-06-01')
  })

  it('Ollama 无需密钥', () => {
    const m = applyVendorTemplate('m-3', 'ollama')
    expect(m.env_key).toBe('')
    expect(m.base_url).toContain('11434')
  })

  it('Azure 带官方 query_params', () => {
    const m = applyVendorTemplate('m-4', 'azure')
    expect(m.query_params['api-version']).toBeTruthy()
  })

  it('拷贝当前只带 URL/协议', () => {
    const cur = emptyModelEntry({
      id: 'old',
      base_url: 'https://api.example.com/v1',
      api_backend: 'responses',
    })
    const m = applyVendorTemplate('m-5', 'copy', cur)
    expect(m.base_url).toBe('https://api.example.com/v1')
    expect(m.api_backend).toBe('responses')
    expect(m.model).toBe('')
  })
})

describe('prepareModelsForSave', () => {
  it('允许空 env_key', () => {
    const m = applyVendorTemplate('ollama-local', 'ollama')
    m.model = 'llama3.1'
    const saved = prepareModelsForSave([m])
    expect(saved[0].env_key).toBe('')
    expect(saved[0].query_params).toEqual({})
  })
})

describe('envKeyChoices / hostFromBaseUrl', () => {
  it('去重并保留常用名', () => {
    const a = applyVendorTemplate('a', 'openai')
    const b = applyVendorTemplate('b', 'openai')
    const keys = envKeyChoices([a, b])
    expect(keys.filter((k) => k === 'OPENAI_API_KEY')).toHaveLength(1)
  })

  it('从 URL 取主机', () => {
    expect(hostFromBaseUrl('https://api.openai.com/v1')).toBe('api.openai.com')
  })
})
