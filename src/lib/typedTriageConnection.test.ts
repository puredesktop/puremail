import { describe, expect, it } from 'vitest'
import { connectionTestRequest, connectionTestMessage } from './typedTriageConnection'
import type { TypedJudgmentResult } from '@purescience/platform-ui/bridge/typedJudgments.mjs'

describe('synthetic TypeSafe connection test', () => {
  it('uses only synthetic content, honors the cap and makes repeat tests distinct', () => {
    const a = connectionTestRequest(17), b = connectionTestRequest(17)
    expect(a.dailyCap).toBe(17)
    expect(Object.keys(a.state)).toEqual(['purpose', 'testId', 'text'])
    expect(a.state).not.toEqual(b.state)
    expect(Object.keys(a.questions)).toEqual(['reply'])
  })
  it.each(['missing-key', 'daily-cap', 'already-attempted', 'unavailable'] as const)('does not report %s as verified', reason => {
    expect(connectionTestMessage({ status: 'skipped', reason })).not.toContain('Connection verified')
  })
  it('distinguishes a valid response from a quality evaluation', () => {
    const result: TypedJudgmentResult = { status:'completed',model:'fixture',latencyMs:40,answers:{},usage:{input_tokens:2,output_tokens:1} }
    expect(connectionTestMessage(result)).toContain('Connection verified · fixture · 40 ms')
    expect(connectionTestMessage(result)).toContain('not triage quality')
  })
})
