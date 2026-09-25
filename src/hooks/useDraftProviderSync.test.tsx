// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDraftProviderSync } from './useDraftProviderSync'
import { emptyMailStore } from '../lib/mailStoreData'
import type { Draft, MailStore } from '../types'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function draft(patch: Partial<Draft> = {}): Draft {
  return {
    id: 'draft_1',
    threadId: 'gmail_thread_x',
    to: [{ name: 'Mira', email: 'mira@example.com' }],
    subject: 'Re: Launch copy',
    body: 'Worth saving.',
    attachments: [],
    updatedAt: '2026-08-19T10:00:00.000Z',
    syncState: 'pending',
    ...patch,
  }
}

/** A deferred promise, so a provider call can be held mid-flight. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Renders the hook and exposes what it returned, so a test can drive
 * forgetDraft the way the shell's discard does.
 */
function mountHook(input: {
  drafts: Draft[]
  provider: Parameters<typeof useDraftProviderSync>[0]['provider']
}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const api: { forgetDraft?: (item: Draft) => void } = {}
  let store: MailStore = { ...emptyMailStore(), drafts: input.drafts }
  const notices: string[] = []
  const errors: string[] = []

  function Harness(): null {
    const { forgetDraft } = useDraftProviderSync({
      store,
      setStore: updater => {
        store = updater(store)
      },
      provider: input.provider,
      onError: message => errors.push(message),
      onNotice: message => notices.push(message),
    })
    api.forgetDraft = forgetDraft
    return null
  }

  act(() => {
    root.render(<Harness />)
  })
  return {
    api,
    notices,
    errors,
    storeNow: () => store,
    unmount: () => act(() => root.unmount()),
  }
}

describe('draft provider sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates the provider draft once the edits settle', async () => {
    const createDraft = vi.fn(async () => 'gmail-draft-1')
    const harness = mountHook({
      drafts: [draft()],
      provider: { capabilities: { drafts: true }, createDraft },
    })
    expect(createDraft).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(createDraft).toHaveBeenCalledTimes(1)
    expect(harness.storeNow().drafts[0].providerDraftId).toBe('gmail-draft-1')
    harness.unmount()
  })

  it('counts an attachment as content worth a provider draft, and pushes it', async () => {
    // A draft that is only a file the agent attached — no subject, no body
    // yet — still belongs in the account's Drafts, attachment included.
    const createDraft = vi.fn(async () => 'gmail-draft-att')
    const attachment = {
      id: 'att_1',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      sizeLabel: '4 B',
      size: 4,
      content: 'data:application/pdf;base64,JVBERg==',
    }
    const harness = mountHook({
      drafts: [draft({ subject: '', body: '', attachments: [attachment] })],
      provider: { capabilities: { drafts: true }, createDraft },
    })
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(createDraft).toHaveBeenCalledTimes(1)
    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [attachment] }),
    )
    harness.unmount()
  })

  it('updates an already-synced draft rather than creating a second one', async () => {
    // Ported from the deleted mailModel.syncDraftToProvider tests: the
    // create-vs-update decision now lives here, in the hook that actually
    // runs in production.
    const createDraft = vi.fn(async () => 'gmail-draft-2')
    const updateDraft = vi.fn(async () => undefined)
    const harness = mountHook({
      drafts: [
        draft({
          providerDraftId: 'gmail-draft-1',
          body: 'Edited after the first save.',
        }),
      ],
      provider: { capabilities: { drafts: true }, createDraft, updateDraft },
    })
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(createDraft).not.toHaveBeenCalled()
    expect(updateDraft).toHaveBeenCalledWith(
      'gmail-draft-1',
      expect.objectContaining({ body: 'Edited after the first save.' }),
    )
    expect(harness.storeNow().drafts[0].syncState).toBe('synced')
    harness.unmount()
  })

  it('deletes the provider draft when a synced draft is discarded', async () => {
    const deleteDraft = vi.fn(async () => undefined)
    const harness = mountHook({
      drafts: [draft({ providerDraftId: 'gmail-draft-1', syncState: 'synced' })],
      provider: {
        capabilities: { drafts: true },
        createDraft: vi.fn(async () => 'x'),
        deleteDraft,
      },
    })
    await act(async () => {
      harness.api.forgetDraft?.(
        draft({ providerDraftId: 'gmail-draft-1', syncState: 'synced' }),
      )
    })
    expect(deleteDraft).toHaveBeenCalledWith('gmail-draft-1')
    expect(harness.notices).toContain('Draft discarded, at the account too.')
    harness.unmount()
  })

  it('removes the provider draft made by a save the discard raced', async () => {
    // The hole this closes: discard while createDraft is still in flight.
    // There is no providerDraftId to delete yet, so without this the save
    // lands a moment later and leaves a draft in the account that PureMail no
    // longer knows about — which the next sync pulls back in.
    const pendingCreate = deferred<string>()
    const createDraft = vi.fn(() => pendingCreate.promise)
    const deleteDraft = vi.fn(async () => undefined)
    const harness = mountHook({
      drafts: [draft()],
      provider: { capabilities: { drafts: true }, createDraft, deleteDraft },
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(createDraft).toHaveBeenCalledTimes(1)
    expect(deleteDraft).not.toHaveBeenCalled()

    // Discard lands while the create is still open.
    await act(async () => {
      harness.api.forgetDraft?.(draft())
    })
    expect(deleteDraft).not.toHaveBeenCalled()

    // Now the save completes and hands over the id.
    await act(async () => {
      pendingCreate.resolve('gmail-draft-late')
      await Promise.resolve()
    })
    expect(deleteDraft).toHaveBeenCalledWith('gmail-draft-late')
    harness.unmount()
  })

  it('does not start a save for a draft discarded during the debounce', async () => {
    const createDraft = vi.fn(async () => 'gmail-draft-1')
    const deleteDraft = vi.fn(async () => undefined)
    const harness = mountHook({
      drafts: [draft()],
      provider: { capabilities: { drafts: true }, createDraft, deleteDraft },
    })
    await act(async () => {
      harness.api.forgetDraft?.(draft())
    })
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    // Nothing was ever created, so there is nothing to delete.
    expect(createDraft).not.toHaveBeenCalled()
    expect(deleteDraft).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('retries a failing delete, and says so plainly when it gives up', async () => {
    const deleteDraft = vi.fn(async () => {
      throw new Error('gmail unavailable')
    })
    const harness = mountHook({
      drafts: [draft({ providerDraftId: 'gmail-draft-1', syncState: 'synced' })],
      provider: {
        capabilities: { drafts: true },
        createDraft: vi.fn(async () => 'x'),
        deleteDraft,
      },
    })
    await act(async () => {
      harness.api.forgetDraft?.(
        draft({ providerDraftId: 'gmail-draft-1', syncState: 'synced' }),
      )
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(deleteDraft.mock.calls.length).toBeGreaterThan(1)
    // A delete that quietly fails would let the next sync add the draft back,
    // so the user has to be told it is coming back.
    expect(harness.errors.join(' ')).toMatch(/come back on the next sync/)
    harness.unmount()
  })

  it('does nothing at all for a provider without draft support', async () => {
    const createDraft = vi.fn(async () => 'x')
    const harness = mountHook({
      drafts: [draft()],
      provider: { capabilities: { drafts: false }, createDraft },
    })
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(createDraft).not.toHaveBeenCalled()
    harness.unmount()
  })
})
