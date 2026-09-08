import { describe, expect, it } from 'vitest'
import {
  allowedModelIds,
  effortValuesFromConfig,
  filterModelsByPolicy,
  parseSessionConfigOptions,
} from './sessionConfig'

const SAMPLE = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    currentValue: 'grok-4',
    options: [
      { value: 'grok-4', name: 'Grok 4' },
      { value: 'grok-4.5', name: 'Grok 4.5', description: 'a requirements.toml pin' },
    ],
  },
  {
    id: 'reasoning_effort',
    name: 'Reasoning Effort',
    category: 'thoughtLevel',
    currentValue: 'high',
    options: [
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' },
      { value: 'grok-4.5-high', name: 'X-High', description: 'per-effort model id' },
    ],
  },
]

describe('parseSessionConfigOptions', () => {
  it('收官方 select flatten JSON', () => {
    const opts = parseSessionConfigOptions(SAMPLE)
    expect(opts).toHaveLength(2)
    expect(opts[0].id).toBe('model')
    expect(opts[0].currentValue).toBe('grok-4')
    expect(opts[0].values.map((v) => v.value)).toEqual(['grok-4', 'grok-4.5'])
    expect(opts[1].values[2].value).toBe('grok-4.5-high')
  })

  it('包一层 options 也能解析', () => {
    expect(parseSessionConfigOptions({ options: SAMPLE })).toHaveLength(2)
  })
})

describe('filterModelsByPolicy', () => {
  const models = [
    { id: 'm-local', model: 'grok-4', name: 'Grok 4' },
    { id: 'm-ban', model: 'secret-model', name: 'Secret' },
    { id: 'grok-4.5', model: 'grok-4.5', name: 'Grok 4.5' },
  ]

  it('没有 model 选项不过滤', () => {
    expect(filterModelsByPolicy(models, [])).toEqual(models)
  })

  it('只留策略允许的 id / model 名', () => {
    const opts = parseSessionConfigOptions(SAMPLE)
    expect(filterModelsByPolicy(models, opts).map((m) => m.id)).toEqual([
      'm-local',
      'grok-4.5',
    ])
    expect(allowedModelIds(opts)?.has('grok-4')).toBe(true)
  })
})

describe('effortValuesFromConfig', () => {
  it('给出官方档位，含 per-effort model id', () => {
    const opts = parseSessionConfigOptions(SAMPLE)
    expect(effortValuesFromConfig(opts)?.map((v) => v.value)).toEqual([
      'low',
      'high',
      'grok-4.5-high',
    ])
  })
})
