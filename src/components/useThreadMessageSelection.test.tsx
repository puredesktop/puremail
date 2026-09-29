// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useThreadMessageSelection } from './useThreadMessageSelection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const container = document.createElement('div')
let root = createRoot(container)
let select: (id: string | null) => void
let reply: () => void
function Reader({ thread, messages, focus = null }: {
  thread: string; messages: Array<{ id: string }>; focus?: string | null
}) {
  const [id, setId] = useThreadMessageSelection(thread, messages, focus)
  const [mode, setMode] = useState('email')
  select = setId
  reply = () => setMode('reply')
  return <div>{mode}:{id}</div>
}
afterEach(async () => {
  await act(async () => root.unmount())
  root = createRoot(container)
})
const messages = [{ id: 'newest' }, { id: 'older' }]
describe('reader selection across mail refreshes', () => {
  it('keeps an older selected message when refreshed mail adds a newer one', async () => {
    await act(async () => root.render(<Reader thread="a" messages={messages} />))
    await act(async () => select('older'))
    await act(async () => root.render(<Reader thread="a" messages={[{ id: 'incoming' }, ...messages]} />))
    expect(container.textContent).toBe('email:older')
  })
  it('keeps a sent-reply view while mail refreshes with an earlier message focus', async () => {
    await act(async () => root.render(<Reader thread="a" messages={messages} focus="older" />))
    await act(async () => reply())
    await act(async () => root.render(<Reader thread="a" messages={[...messages]} focus="older" />))
    expect(container.textContent).toBe('reply:older')
  })
  it('honors a requested message and falls back when it is removed', async () => {
    await act(async () => root.render(<Reader thread="a" messages={messages} focus="older" />))
    expect(container.textContent).toBe('email:older')
    await act(async () => root.render(<Reader thread="a" messages={[{ id: 'newest' }]} focus="older" />))
    expect(container.textContent).toBe('email:newest')
  })
  it('selects the newest visible message on changing conversations', async () => {
    await act(async () => root.render(<Reader thread="a" messages={messages} />))
    await act(async () => select('older'))
    await act(async () => root.render(<Reader thread="b" messages={[{ id: 'other' }]} />))
    expect(container.textContent).toBe('email:other')
    await act(async () => root.render(<Reader thread="b" messages={[]} />))
    expect(container.textContent).toBe('email:')
  })
})
