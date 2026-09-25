// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const sanitizeSpy = vi.fn(
  (html: string, _options: { allowRemoteImages: boolean }) => html,
)

vi.mock('../lib/sanitizeMailHtml', () => ({
  sanitizeMailHtml: (html: string, options: { allowRemoteImages: boolean }) =>
    sanitizeSpy(html, options),
  mailHtmlHasRemoteImages: () => false,
}))

const { SanitizedMessageBody } = await import('./ThreadReader')

/**
 * The sanitizer is a DOMParser plus a full tree walk — milliseconds per
 * message. Compose state lives in the shell above the reader, so before this
 * was memoized every keystroke re-sanitized every message in the open thread,
 * and typing in the compose box lagged.
 *
 * These are performance guarantees written as behaviour: if someone inlines
 * the call back into the render, the first test fails.
 */
describe('a message body is sanitized once, not once per render', () => {
  const render = (
    node: React.ReactElement,
  ): { rerender: (next: React.ReactElement) => void } => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(node))
    return {
      rerender: next => {
        act(() => root.render(next))
      },
    }
  }

  it('does not re-sanitize when the parent re-renders with the same message', () => {
    sanitizeSpy.mockClear()
    const view = render(
      <SanitizedMessageBody bodyHtml="<p>Hello</p>" allowRemoteImages={false} />,
    )
    expect(sanitizeSpy).toHaveBeenCalledTimes(1)

    // What a keystroke in the compose box does: re-render, same message.
    view.rerender(
      <SanitizedMessageBody bodyHtml="<p>Hello</p>" allowRemoteImages={false} />,
    )
    view.rerender(
      <SanitizedMessageBody bodyHtml="<p>Hello</p>" allowRemoteImages={false} />,
    )
    expect(sanitizeSpy).toHaveBeenCalledTimes(1)
  })

  it('does re-sanitize when the message changes', () => {
    sanitizeSpy.mockClear()
    const view = render(
      <SanitizedMessageBody bodyHtml="<p>One</p>" allowRemoteImages={false} />,
    )
    view.rerender(
      <SanitizedMessageBody bodyHtml="<p>Two</p>" allowRemoteImages={false} />,
    )
    expect(sanitizeSpy).toHaveBeenCalledTimes(2)
  })

  it('does re-sanitize when remote images are allowed, which changes the output', () => {
    // Load images must actually reload the body, or the button does nothing.
    sanitizeSpy.mockClear()
    const view = render(
      <SanitizedMessageBody bodyHtml="<p>One</p>" allowRemoteImages={false} />,
    )
    view.rerender(
      <SanitizedMessageBody bodyHtml="<p>One</p>" allowRemoteImages />,
    )
    expect(sanitizeSpy).toHaveBeenCalledTimes(2)
    expect(sanitizeSpy).toHaveBeenLastCalledWith('<p>One</p>', {
      allowRemoteImages: true,
    })
  })
})
