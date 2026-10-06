// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MailTimezonePanel } from './MailTimezonePanel'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('shows mentions, converts after a source zone is supplied and closes', async () => {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const close = vi.fn()
 try {
  await act(async () => root.render(<MailTimezonePanel source="At 3pm. October 8, 2026 at 10am UTC." receivedAt="2026-10-06T12:00:00Z" onClose={close}/>))
  expect(host.querySelectorAll('article')).toHaveLength(2)
  expect(host.textContent).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone)
  expect(host.textContent).toContain('Enter the source timezone')
  const input = host.querySelector<HTMLInputElement>('input[type="text"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Europe/London'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(host.textContent).not.toContain('Enter the source timezone')
  expect(host.textContent).toContain('inferred — check')
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(close).toHaveBeenCalledOnce()
 } finally { await act(async () => root.unmount()); host.remove() }
})
