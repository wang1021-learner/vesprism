import { describe, expect, it } from 'vitest'
import { compositionToYaml, emptyComposition } from './composition'

describe('组装单 flows 字段', () => {
  it('序列化到 YAML 且不含绝对路径', () => {
    const yaml = compositionToYaml({ ...emptyComposition(), flows: ['demo-linear'] })
    expect(yaml).toContain('flows:')
    expect(yaml).toContain('demo-linear')
    expect(yaml).not.toMatch(/[A-Za-z]:[\\/]/)
  })
})
