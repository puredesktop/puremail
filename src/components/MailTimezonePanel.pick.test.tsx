// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

// The time mentions themselves come from chrono-node (not under test here): two times, one named "UK" in its sentence.
vi.mock('../lib/mailTimezone', () => ({
  emailTimes: (text: string) => [
    { text: '2pm UK', index: text.indexOf('2pm UK'), date: '2026-10-07', hour: 14, minute: 0, offset: null, assumedDate: true, assumedMeridiem: false },
    { text: '5pm', index: text.indexOf('5pm'), date: '2026-10-07', hour: 17, minute: 0, offset: null, assumedDate: true, assumedMeridiem: false },
  ].filter(m => m.index >= 0),
  convertTime: (_d: string, h: number, _m: number, zone: string) => (zone ? `${h}:00 from ${zone}` : 'Enter the source timezone to convert this time.'),
}))
const { MailTimezonePanel } = await import('./MailTimezonePanel')
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mount = async (source: string) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<MailTimezonePanel source={source} receivedAt="2026-10-07T09:00:00Z" onClose={() => undefined} />))
  return host
}
const type = async (input: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { input.focus(); input.dispatchEvent(new Event('focus', { bubbles: true })) })
  await act(async () => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('the timezone panel', () => {
  it('guesses the zone from the email’s words and says so, for every time in it', async () => {
    const host = await mount('that is at 2pm UK and quite local – so I should be OK for our call at 5pm.')
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')]
    expect(inputs.map(i => i.value)).toEqual(['London (Europe)', 'London (Europe)'])
    expect(host.textContent).toContain('Guessed from “uk” in the email')
    expect(host.textContent).toContain('17:00 from Europe/London')
  })

  it('offers zones as they are typed, by city, country or abbreviation, and takes the pick', async () => {
    const host = await mount('call at 5pm.')
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!
    expect(input.value).toBe('')
    await type(input, 'new y')
    const options = [...host.querySelectorAll('[role="option"]')].map(o => o.textContent)
    expect(options[0]).toContain('New York (America)')
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(input.value).toBe('New York (America)')
    expect(host.textContent).toContain('17:00 from America/New_York')
    await type(input, 'ist')
    expect([...host.querySelectorAll('[role="option"]')][0]?.textContent).toContain('Kolkata')
  })
})
