// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@purescience/platform-ui/bridge/typedJudgments.mjs', () => ({
  getTypedJudgmentStatus: async () => ({ configured: true, today: 51, recent: [] }),
}))
vi.mock('../lib/triagePersistence', () => ({ readTriageFile: async () => ({ byMessageId: {} }) }))
vi.mock('../lib/typedTriageConnection', () => ({
  testTypedTriageConnection: async () => ({ status: 'completed', model: 'jev-1.13.0', latencyMs: 179 }),
  connectionTestMessage: () => 'Connection verified · jev-1.13.0 · 179 ms.',
}))
const { TypedTriageSettings } = await import('./TypedTriageSettings')
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const settings = { typedTriage: { provider: 'typesafe', mode: 'suggest', dailyCap: 50, confidence: 0.7, localConfidence: 0.7, localModel: '' } }
const setv = (input: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) }

describe('automatic triage settings', () => {
  it('takes a cap typed afresh, and lights the test button green once the connection is verified', async () => {
    let store = { settings, messages: [], threads: [] } as never
    const setStore = (update: unknown) => { store = typeof update === 'function' ? (update as (s: unknown) => unknown)(store) as never : update as never }
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const render = () => act(async () => root.render(<TypedTriageSettings store={store} setStore={setStore as never} onRunTriage={vi.fn(async () => ({ completed: 0 })) as never} />))
    await render()
    const cap = host.querySelector<HTMLInputElement>('input[aria-label="Triage daily cap"]')!
    // Cleared, then typed: the field keeps what is typed, and the setting saves once it is valid.
    await act(async () => setv(cap, ''))
    expect(cap.value).toBe('')
    expect(cap.getAttribute('aria-invalid')).toBe('true')
    await act(async () => setv(cap, '500'))
    expect((store as { settings: typeof settings }).settings.typedTriage.dailyCap).toBe(500)
    await render()
    expect(cap.value).toBe('500')
    expect(host.textContent).toContain('51 of 500 requests')

    const test = host.querySelector<HTMLButtonElement>('button[aria-label^="Test connection"]')!
    expect(test.getAttribute('aria-label')).toContain('not tested')
    await act(async () => test.click())
    expect(test.getAttribute('aria-label')).toContain('Connection verified')
    expect(host.textContent).toContain('Connection verified · jev-1.13.0 · 179 ms.')
    await act(async () => root.unmount()); host.remove()
  })
})
