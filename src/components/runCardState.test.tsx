// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { demoMailStoreForNow } from '../lib/mailModel'
import { createRunTemplateDraft } from '../lib/mailRuns'
import type { Draft, MailStore } from '../types'
import {
  runCardDiffersFromDraft,
  seedRunCard,
  storeWithRunCardSaved,
  useRunCard,
  type RunCardFields,
  type RunCardSetters,
} from './runCardState'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = '2026-09-02T10:00:00.000Z'

function baseDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'draft_run_1',
    threadId: 'thread_run_1',
    to: [{ name: 'Sarah Example', email: 'sarah@design.example' }],
    subject: 'Hello Sarah',
    body: 'Hi Sarah',
    bodyHtml: '<p>Hi Sarah</p>',
    attachments: [],
    updatedAt: NOW,
    syncState: 'pending',
    ...overrides,
  }
}

/** Mount the hook and expose its latest result plus a way to swap the draft. */
function mountCard(initial: Draft | null): {
  current: () => { card: RunCardFields | null; setters: RunCardSetters }
  setDraft: (draft: Draft | null) => void
} {
  let latest: { card: RunCardFields | null; setters: RunCardSetters } | null = null
  let setDraftState: ((draft: Draft | null) => void) | null = null
  function Harness(): null {
    const [draft, setDraft] = useState<Draft | null>(initial)
    setDraftState = setDraft
    latest = useRunCard(draft)
    return null
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => {
    root.render(<Harness />)
  })
  return {
    current: () => latest!,
    setDraft: draft => {
      act(() => setDraftState!(draft))
    },
  }
}

describe('useRunCard', () => {
  it('seeds from the draft and re-seeds (with a new seed) when the draft changes id', () => {
    const harness = mountCard(baseDraft())
    expect(harness.current().card).toMatchObject({ draftId: 'draft_run_1', subject: 'Hello Sarah', seed: 0 })
    harness.setDraft(baseDraft({ id: 'draft_run_2', threadId: 'thread_run_2', subject: 'Hello Tom' }))
    expect(harness.current().card).toMatchObject({ draftId: 'draft_run_2', subject: 'Hello Tom' })
    harness.setDraft(null)
    expect(harness.current().card).toBeNull()
  })

  it('re-seeds when something else rewrites the draft, so stale fields never autosave over it', () => {
    const harness = mountCard(baseDraft())
    // The drawer agent's updateDraft lands: new object, new content.
    harness.setDraft(baseDraft({ subject: 'Rewritten by the agent', body: 'New body', bodyHtml: '<p>New body</p>', updatedAt: '2026-09-02T10:01:00.000Z' }))
    expect(harness.current().card).toMatchObject({ subject: 'Rewritten by the agent', body: 'New body', seed: 1 })
  })

  it('keeps what the user typed when the draft object changes without a content change', () => {
    const harness = mountCard(baseDraft())
    act(() => harness.current().setters.setSubject('Typing…'))
    expect(harness.current().card?.subject).toBe('Typing…')
    // Provider sync touches the draft (sync state) — same content.
    harness.setDraft(baseDraft({ syncState: 'synced', providerDraftId: 'gmail_1' }))
    expect(harness.current().card).toMatchObject({ subject: 'Typing…', seed: 0 })
  })

  it("treats the card's own save landing as no external change", () => {
    const harness = mountCard(baseDraft())
    act(() => harness.current().setters.setSubject('Saved subject'))
    // The autosave wrote the card into the draft: the new draft equals the card.
    harness.setDraft(baseDraft({ subject: 'Saved subject', updatedAt: '2026-09-02T10:02:00.000Z' }))
    expect(harness.current().card).toMatchObject({ subject: 'Saved subject', seed: 0 })
    expect(runCardDiffersFromDraft(harness.current().card!, baseDraft({ subject: 'Saved subject' }))).toBe(false)
  })
})

describe('storeWithRunCardSaved', () => {
  function storeWithDraft(): { store: MailStore; draft: Draft } {
    const base = demoMailStoreForNow(new Date(NOW))
    const template = createRunTemplateDraft(base, { accountId: base.accounts[0]!.id, subject: 'First', body: 'x' }, NOW)
    return { store: template.store, draft: template.draft }
  }

  it('is identity when the card matches the draft, and keeps an empty subject empty', () => {
    const { store, draft } = storeWithDraft()
    expect(storeWithRunCardSaved(store, seedRunCard(draft))).toBe(store)
    const cleared = { ...seedRunCard(draft), subject: '' }
    const saved = storeWithRunCardSaved(store, cleared, '2026-09-02T10:05:00.000Z')
    const savedDraft = saved.drafts.find(item => item.id === draft.id)!
    expect(savedDraft.subject).toBe('')
    expect(savedDraft.updatedAt).toBe('2026-09-02T10:05:00.000Z')
    // A run thread follows its draft: no subject → the template fallback.
    expect(saved.threads.find(thread => thread.id === draft.threadId)!.subject).toBe('Run template')
  })

  it('writes the card in place (same id) and the run thread follows the subject and recipient', () => {
    const { store, draft } = storeWithDraft()
    const card = { ...seedRunCard(draft), subject: 'Workshop dates', to: 'Mere Example <mere@paper.example>', body: 'Hi Mere' }
    const saved = storeWithRunCardSaved(store, card, '2026-09-02T10:05:00.000Z')
    const savedDraft = saved.drafts.find(item => item.id === draft.id)!
    expect(savedDraft.subject).toBe('Workshop dates')
    expect(savedDraft.to).toEqual([{ name: 'Mere Example', email: 'mere@paper.example' }])
    const thread = saved.threads.find(item => item.id === draft.threadId)!
    expect(thread.subject).toBe('Workshop dates')
    expect(thread.participants.map(contact => contact.email)).toContain('mere@paper.example')
    expect(saved.drafts).toHaveLength(store.drafts.length)
  })

  it('never writes into a sent draft', () => {
    const { store, draft } = storeWithDraft()
    const sentStore: MailStore = { ...store, drafts: store.drafts.map(item => (item.id === draft.id ? { ...item, sentAt: NOW } : item)) }
    expect(storeWithRunCardSaved(sentStore, { ...seedRunCard(draft), subject: 'late edit' })).toBe(sentStore)
  })
})
