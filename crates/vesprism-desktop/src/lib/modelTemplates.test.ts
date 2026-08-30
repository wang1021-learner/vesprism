import { describe, expect, it } from 'vitest'
import { applyVendorTemplate, envKeyChoices, hostFromBaseUrl } from './modelTemplates'
import { emptyModelEntry, isOfficialModel, prepareModelsForSave } from './models'

describe('isOfficialModel', () => {
  it('登录目录与自配分开', () => {
    expect(isOfficialModel({ source: 'official' })).toBe(true)
    expect(isOfficialModel({ source: 'custom' })).toBe(false)
    expect(isOfficialModel({})).toBe(false)
  })
})

describe('applyVendorTemplate', () => {
  it('xAI 走官方 responses 且不强制环境变量密钥', () => {
    const m = applyVendorTemplate('grok-4.6', 'xai')
    expect(m.base_url).toBe('https://api.x.ai/v1')
    expect(m.api_backend).toBe('responses')
    expect(m.env_key).toBe('')
    expect(m.model).toBe('grok-4.6')
    expect(m.supports_reasoning_effort).toBe(true)
  })

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

  it('拷贝当前带上同一把密钥和请求头，模型名留空', () => {
    const cur = emptyModelEntry({
      id: 'old',
      base_url: 'https://api.example.com/v1',
      api_backend: 'responses',
      env_key: 'OPENAI_API_KEY',
      extra_headers: { 'X-Test': '1' },
      supports_reasoning_effort: true,
      reasoning_effort: 'high',
    })
    const m = applyVendorTemplate('m-5', 'copy', cur)
    expect(m.base_url).toBe('https://api.example.com/v1')
    expect(m.api_backend).toBe('responses')
    expect(m.env_key).toBe('OPENAI_API_KEY')
    expect(m.extra_headers['X-Test']).toBe('1')
    expect(m.supports_reasoning_effort).toBe(true)
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

  it('DeepSeek 推理档默认写成 high，不把 medium 写进配置', () => {
    const m = applyVendorTemplate('ds', 'deepseek')
    expect(m.reasoning_effort).toBe('high')
    const saved = prepareModelsForSave([m])
    expect(saved[0].reasoning_effort).toBe('high')
    m.reasoning_effort = 'medium'
    expect(prepareModelsForSave([m])[0].reasoning_effort).toBe('high')
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
