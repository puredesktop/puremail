import { describe, expect, it } from 'vitest'
import {
  demoMailStore,
  emptyMailStore,
  parsePersistedMailStore,
} from './mailModel'
import {
  defaultMailNotificationPreferences,
  MAIL_STORE_VERSION,
  migratePersistedMailStore,
} from './mailStoreMigration'
import type { MailStore } from '../types'

/**
 * A pre-M0 persisted store: the shape shipped before storeVersion existed.
 * Built by stripping every Phase M0 field from the current demo store.
 */
function legacyStore(): MailStore {
  const store = demoMailStore()
  const {
    storeVersion: _storeVersion,
    starredThreadIds: _starred,
    pinnedThreadIds: _pinned,
    snoozes: _snoozes,
    providerLabels: _providerLabels,
    queuedActions: _queuedActions,
    scheduledSends: _scheduledSends,
    notificationPreferences: _notificationPreferences,
    ...legacy
  } = store
  return legacy as MailStore
}

describe('mail store migration (issue #153 defensiveness)', () => {
  it('migrates a pre-versioning store to the current shape with defaults', () => {
    const migrated = migratePersistedMailStore(legacyStore())
    expect(migrated.storeVersion).toBe(MAIL_STORE_VERSION)
    expect(migrated.starredThreadIds).toEqual([])
    expect(migrated.pinnedThreadIds).toEqual([])
    expect(migrated.providerLabels).toEqual([])
    expect(migrated.queuedActions).toEqual([])
    expect(migrated.scheduledSends).toEqual([])
    expect(migrated.notificationPreferences).toEqual(
      defaultMailNotificationPreferences(),
    )
  })

  it('does not disturb existing collections during migration', () => {
    const legacy = legacyStore()
    const migrated = migratePersistedMailStore(legacy)
    expect(migrated.threads).toEqual(legacy.threads)
    expect(migrated.messages).toEqual(legacy.messages)
    expect(migrated.drafts).toEqual(legacy.drafts)
    expect(migrated.tasks).toEqual(legacy.tasks)
    expect(migrated.settings).toEqual(legacy.settings)
  })

  it('preserves unknown fields written by newer builds', () => {
    const legacy = {
      ...legacyStore(),
      futureFeatureState: { anything: true },
    } as MailStore & { futureFeatureState: unknown }
    const migrated = migratePersistedMailStore(legacy) as MailStore & {
      futureFeatureState?: unknown
    }
    expect(migrated.futureFeatureState).toEqual({ anything: true })
  })

  it('backfills snooze metadata from legacy thread snoozedUntil markers', () => {
    const legacy = legacyStore()
    const snoozedThread = {
      ...legacy.threads[0],
      status: 'snoozed' as const,
      snoozedUntil: '2026-07-10T09:00:00.000Z',
    }
    const migrated = migratePersistedMailStore({
      ...legacy,
      threads: [snoozedThread, ...legacy.threads.slice(1)],
    })
    expect(migrated.snoozes).toEqual([
      {
        threadId: snoozedThread.id,
        snoozedUntil: '2026-07-10T09:00:00.000Z',
        snoozedAt: snoozedThread.lastMessageAt,
        returnMailboxId: snoozedThread.mailboxId,
        reason: 'manual',
      },
    ])
  })

  it('keeps existing snooze records instead of re-synthesizing them', () => {
    const legacy = legacyStore()
    const snoozedThread = {
      ...legacy.threads[0],
      status: 'snoozed' as const,
      snoozedUntil: '2026-07-10T09:00:00.000Z',
    }
    const existing = {
      threadId: snoozedThread.id,
      snoozedUntil: '2026-07-10T09:00:00.000Z',
      snoozedAt: '2026-07-01T08:00:00.000Z',
      returnMailboxId: 'mailbox_inbox',
      reason: 'follow_up' as const,
    }
    const migrated = migratePersistedMailStore({
      ...legacy,
      threads: [snoozedThread, ...legacy.threads.slice(1)],
      snoozes: [existing],
    })
    expect(migrated.snoozes).toEqual([existing])
  })

  it('drops malformed entries from the new collections without losing valid ones', () => {
    const valid = {
      id: 'queued_1',
      type: 'archive',
      threadId: 'thread_launch',
      queuedAt: '2026-07-01T00:00:00.000Z',
      attempts: 0,
    }
    const migrated = migratePersistedMailStore({
      ...legacyStore(),
      starredThreadIds: ['thread_launch', 42, null],
      queuedActions: [valid, { corrupt: true }, 'garbage', null],
    } as unknown as MailStore)
    expect(migrated.starredThreadIds).toEqual(['thread_launch'])
    expect(migrated.queuedActions).toEqual([valid])
  })

  it('normalizes broken notification preferences while preserving unknown sub-fields', () => {
    const migrated = migratePersistedMailStore({
      ...legacyStore(),
      notificationPreferences: {
        enabled: 'yes',
        scope: 'sometimes',
        soundEnabled: true,
        futureSubSetting: 'kept',
      },
    } as unknown as MailStore) as MailStore & {
      notificationPreferences: { futureSubSetting?: string }
    }
    expect(migrated.notificationPreferences).toMatchObject({
      enabled: true,
      scope: 'important',
      soundEnabled: true,
      futureSubSetting: 'kept',
    })
  })

  it('is idempotent on an already-current store', () => {
    const once = migratePersistedMailStore(legacyStore())
    const twice = migratePersistedMailStore(once)
    expect(twice).toEqual(once)
  })

  it('migrates through parsePersistedMailStore on a persisted legacy blob', () => {
    const raw = JSON.stringify({
      ...legacyStore(),
      unknownTopLevelField: 'still-here',
    })
    const parsed = parsePersistedMailStore(raw) as (MailStore & {
      unknownTopLevelField?: string
    }) | null
    expect(parsed).not.toBeNull()
    expect(parsed?.storeVersion).toBe(MAIL_STORE_VERSION)
    expect(parsed?.starredThreadIds).toEqual([])
    expect(parsed?.snoozes).toEqual([])
    expect(parsed?.notificationPreferences).toEqual(
      defaultMailNotificationPreferences(),
    )
    expect(parsed?.unknownTopLevelField).toBe('still-here')
  })
})

describe('re-homed draft migration (store version 3)', () => {
  const conversation = {
    id: 'gmail_thread_x',
    accountId: 'acc',
    mailboxId: 'mb_inbox',
    subject: 'Launch copy',
    participants: [],
    labels: [],
    status: 'inbox' as const,
    priority: 'none' as const,
    summary: 'summary',
    lastMessageAt: '2026-08-18T10:00:00.000Z',
    syncState: 'synced' as const,
  }
  const sourceMessage = {
    id: 'gmail_msg_1',
    threadId: 'gmail_thread_x',
    from: { name: 'Mira', email: 'mira@example.com' },
    to: [{ name: 'User', email: 'alex@example.com' }],
    subject: 'Launch copy',
    body: 'Can you approve?',
    receivedAt: '2026-08-18T10:00:00.000Z',
    attachments: [],
    read: true,
  }
  const filedThread = {
    ...conversation,
    id: 'thread_draft_autodraft_gmail_thread_x',
    mailboxId: 'mb_drafts',
    status: 'waiting' as const,
  }
  const baseDraft = {
    id: 'autodraft_gmail_thread_x',
    threadId: 'thread_draft_autodraft_gmail_thread_x',
    to: [],
    subject: 'Re: Launch copy',
    body: 'Approved, shipping Friday.',
    attachments: [],
    updatedAt: '2026-08-18T11:00:00.000Z',
    syncState: 'pending' as const,
    draftKind: 'auto_reply' as const,
  }

  function storeWith(draft: MailStore['drafts'][number]): MailStore {
    return {
      ...emptyMailStore(),
      threads: [conversation, filedThread],
      messages: [sourceMessage],
      drafts: [draft],
    }
  }

  it('reattaches a re-homed draft to its conversation via sourceMessageId', () => {
    const migrated = migratePersistedMailStore(
      storeWith({ ...baseDraft, sourceMessageId: 'gmail_msg_1' }),
    )
    expect(migrated.drafts[0].threadId).toBe('gmail_thread_x')
    expect(migrated.drafts[0].body).toBe('Approved, shipping Friday.')
    expect(migrated.threads.map(thread => thread.id)).toEqual([
      'gmail_thread_x',
    ])
    expect(migrated.storeVersion).toBe(3)
  })

  it('reattaches via the reply intent when there is no source message', () => {
    const migrated = migratePersistedMailStore(
      storeWith({
        ...baseDraft,
        replyIntent: {
          threadId: 'gmail_thread_x',
          asker: null,
          recipient: null,
          askText: '',
          askType: 'unclear',
          responseMode: 'unclear',
          requestedAction: '',
          owedResponse: '',
          neededOutput: '',
          suggestedApps: [],
          missingInformation: [],
          confidence: 'low',
          quote: '',
          summary: '',
        },
      }),
    )
    expect(migrated.drafts[0].threadId).toBe('gmail_thread_x')
    expect(
      migrated.threads.some(thread => thread.id.startsWith('thread_draft_')),
    ).toBe(false)
  })

  it('keeps the synthetic thread when the source cannot be established', () => {
    const migrated = migratePersistedMailStore(storeWith(baseDraft))
    // Better a draft on a synthetic thread than a draft on no thread at all.
    expect(migrated.drafts[0].threadId).toBe(
      'thread_draft_autodraft_gmail_thread_x',
    )
    expect(
      migrated.threads.some(
        thread => thread.id === 'thread_draft_autodraft_gmail_thread_x',
      ),
    ).toBe(true)
  })

  it('is a no-op for a store with no re-homed drafts', () => {
    const store: MailStore = {
      ...emptyMailStore(),
      threads: [conversation],
      messages: [sourceMessage],
      drafts: [{ ...baseDraft, threadId: 'gmail_thread_x' }],
    }
    const migrated = migratePersistedMailStore(store)
    expect(migrated.drafts).toEqual(store.drafts)
    expect(migrated.threads).toEqual(store.threads)
  })
})
