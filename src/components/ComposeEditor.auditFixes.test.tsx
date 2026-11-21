// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'styled-components'
import { createComposedMessageDraft, emptyMailStore } from '../lib/mailModel'
import type { Attachment } from '../types'
import { ComposeEditor, type ComposeEditorProps } from './ComposeEditor'

vi.mock('@purescience/platform-ui/release/gesture', async original => ({
  ...(await original<object>()),
  isPersonGesture: () => true,
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<ReturnType<typeof createRoot>> = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
})

async function renderCompose(overrides: Partial<ComposeEditorProps> = {}) {
  const made = createComposedMessageDraft(emptyMailStore(), {
    to: [{ name: 'Ana', email: 'ana@example.test' }],
    subject: 'Letter',
    body: 'Hello',
    attachments: [],
  })
  const storeRef = { current: made.store }
  const setStore = vi.fn((update: unknown) => {
    storeRef.current =
      typeof update === 'function'
        ? (update as (s: typeof made.store) => typeof made.store)(storeRef.current)
        : (update as typeof made.store)
  })
  const schedulePendingSend = vi.fn(() => true)
  const undoPendingSend = vi.fn()
  const noop = () => {}
  const props = {
    store: made.store,
    setStore,
    storeRef,
    activeProvider: 'gmail',
    mailProviderRef: { current: { send: vi.fn(), capabilities: { compose: true } } },
    selectedAccount: {
      id: 'account',
      provider: 'gmail',
      name: 'Me',
      email: 'me@example.test',
      syncState: 'online',
    },
    composeTo: 'ana@example.test',
    composeCc: '',
    composeBcc: '',
    composeCcBccOpen: false,
    composeSubject: 'Letter',
    composeBody: 'Hello',
    composeBodyHtml: '<p>Hello</p>',
    composeAttachments: [] as Attachment[],
    composeDropActive: false,
    setComposeTo: noop,
    setComposeCc: noop,
    setComposeBcc: noop,
    setComposeCcBccOpen: noop,
    setComposeSubject: noop,
    setComposeBody: noop,
    setComposeBodyHtml: noop,
    setComposeAttachments: noop,
    setComposeDropActive: noop,
    setComposeOpen: noop,
    composeContext: {
      threadId: made.store.drafts[0]!.threadId,
      messageId: null,
      kind: 'draft',
      draftId: made.draftId,
    },
    composeQuote: null,
    setComposeQuote: noop,
    switchComposeReplyKind: noop,
    onResetComposeContext: noop,
    discardContextDraft: noop,
    composeToRef: { current: null },
    pendingSend: null,
    schedulePendingSend,
    undoPendingSend,
    sendDraftThroughProvider: vi.fn(),
    markDraftSending: noop,
    setCommandNotice: vi.fn(),
    ...overrides,
  } as unknown as ComposeEditorProps

  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  await act(async () =>
    root.render(
      <ThemeProvider theme={{}}>
        <ComposeEditor {...props} />
      </ThemeProvider>,
    ),
  )
  return { host, schedulePendingSend, undoPendingSend, setStore }
}

describe('ComposeEditor audit fixes and must-have UX', () => {
  it('allows "Send anyway" on missing subject without looping back to the banner', async () => {
    const { host, schedulePendingSend } = await renderCompose({
      composeSubject: '',
      composeBody: 'Quick update without a subject',
    })
    const sendBtn = host.querySelector<HTMLButtonElement>('button[data-release="send"]')!
    await act(async () => {
      sendBtn.click()
    })
    expect(schedulePendingSend).not.toHaveBeenCalled()
    const sendAnyway = Array.from(host.querySelectorAll('button')).find(btn =>
      btn.textContent?.includes('Send anyway'),
    )
    expect(sendAnyway).toBeTruthy()
    await act(async () => {
      sendAnyway!.click()
    })
    expect(schedulePendingSend).toHaveBeenCalledTimes(1)
  })

  it('sanitizes untrusted draft bodyHtml while preserving data-run-note, blocking remote pixels in editor, and restoring image src on edit sync', async () => {
    const syncedHtmls: string[] = []
    const { host } = await renderCompose({
      composeBodyHtml:
        '<p>Safe</p><div data-run-note=""><p>Personal note</p></div><img src="https://tracker.example/p.gif"><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>',
      setComposeBodyHtml: next => {
        if (typeof next === 'string') syncedHtmls.push(next)
      },
    })
    const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')!
    expect(editor.innerHTML).toContain('Safe')
    expect(editor.innerHTML).not.toContain('onerror')
    expect(editor.innerHTML).not.toContain('<script')
    expect(editor.querySelector('[data-run-note]')).toBeTruthy()
    expect(editor.innerHTML).not.toMatch(/\ssrc="https:/)
    expect(editor.innerHTML).toContain('data-puremail-blocked-src=')
    // Editing the body syncs back valid `src="https://..."` without losing images or leaking blocked attr.
    await act(async () => {
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const latestSynced = syncedHtmls.at(-1) ?? ''
    expect(latestSynced).toContain('src="https://tracker.example/p.gif"')
    expect(latestSynced).not.toContain('data-puremail-blocked-src')
  })

  it('enables Send for Bcc-only and attachment-only drafts, shows From identity and duplicate-recipient warning', async () => {
    const attachment: Attachment = {
      id: 'att_1',
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeLabel: '12 KB',
    }
    const { host } = await renderCompose({
      composeTo: '',
      composeCc: 'ana@example.test',
      composeBcc: 'ana@example.test',
      composeCcBccOpen: true,
      composeSubject: 'Invoice',
      composeBody: '',
      composeBodyHtml: '',
      composeAttachments: [attachment],
    })
    const sendBtn = host.querySelector<HTMLButtonElement>('button[data-release="send"]')!
    expect(sendBtn.disabled).toBe(false)
    expect(host.textContent).toContain('me@example.test')
    expect(host.textContent).toContain('ana@example.test appears in Cc and Bcc')
    expect(host.textContent).toContain('Saving…')
  })
})
