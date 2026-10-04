// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MailConnectionControl } from './MailDeliveryStatus'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('renders only a compact connection button and status light', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); const test = vi.fn()
  try {
    await act(async () => root.render(<MailConnectionControl state="healthy" onTest={test} />))
    expect(host.textContent).toBe('Test connection')
    expect(host.querySelector('button')?.title).toContain('Receiving and sending connections verified')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await act(async () => host.querySelector('button')!.click())
    expect(test).toHaveBeenCalledOnce()
    await act(async () => root.render(<MailConnectionControl state="error" onTest={test} />))
    expect(host.textContent).toBe('Test connection')
    expect(host.querySelector('button')?.title).toContain('needs attention')
    await act(async () => root.render(<MailConnectionControl state="checking" onTest={test} />))
    expect(host.querySelector('button')!.disabled).toBe(true)
  } finally { await act(async () => root.unmount()); host.remove() }
})
