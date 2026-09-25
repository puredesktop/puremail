import { describe, expect, it } from 'vitest'
import { demoMailStore } from './mailModel'
import {
  bodyMentionsAttachment,
  defaultSignatureForAccount,
  escapeComposeHtml,
  invalidRecipientsInInput,
  isValidEmailAddress,
  parseRecipientInput,
  plainTextToComposeHtml,
  rankedCorrespondents,
  removeSignature,
  signaturesForAccount,
  upsertSignature,
} from './mailCompose'
import type { MailSettings, MailStore } from '../types'

describe('recipient validation', () => {
  it('accepts normal addresses and rejects malformed ones loudly', () => {
    expect(isValidEmailAddress('mira@example.com')).toBe(true)
    expect(isValidEmailAddress('first.last+tag@sub.example.co')).toBe(true)
    expect(isValidEmailAddress('mira@example')).toBe(false)
    expect(isValidEmailAddress('mira example.com')).toBe(false)
    expect(isValidEmailAddress('@example.com')).toBe(false)
    expect(isValidEmailAddress('mira@')).toBe(false)
    expect(isValidEmailAddress('')).toBe(false)
  })

  it('parses Name <email> and bare tokens, keeping invalid ones visible', () => {
    const parsed = parseRecipientInput(
      'Mira <mira@example.com>, kim@example.com; broken@nowhere',
    )
    expect(parsed).toEqual([
      { name: 'Mira', email: 'mira@example.com' },
      { name: 'kim@example.com', email: 'kim@example.com' },
      { name: 'broken@nowhere', email: 'broken@nowhere' },
    ])
    expect(
      invalidRecipientsInInput(
        'Mira <mira@example.com>, broken@nowhere',
      ).map(contact => contact.email),
    ).toEqual(['broken@nowhere'])
  })
})

describe('correspondent autocomplete ranking', () => {
  function storeWithMessages(): MailStore {
    const store = demoMailStore()
    const now = new Date()
    const daysAgo = (days: number): string =>
      new Date(now.getTime() - days * 86_400_000).toISOString()
    const thread = store.threads[0]!
    const extraMessages = [
      // Frequent but old correspondent.
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `msg_old_${index}`,
        threadId: thread.id,
        from: { name: 'Old Timer', email: 'old@example.com' },
        to: [{ name: 'Alex Example', email: 'alex@example.com' }],
        subject: 'old',
        body: 'old',
        receivedAt: daysAgo(90),
        attachments: [],
        read: true,
      })),
      // Recent correspondent, fewer appearances.
      ...Array.from({ length: 2 }, (_, index) => ({
        id: `msg_recent_${index}`,
        threadId: thread.id,
        from: { name: 'Recent Rina', email: 'rina@example.com' },
        to: [{ name: 'Alex Example', email: 'alex@example.com' }],
        subject: 'recent',
        body: 'recent',
        receivedAt: daysAgo(1),
        attachments: [],
        read: true,
      })),
    ]
    return { ...store, messages: [...store.messages, ...extraMessages] }
  }

  it('ranks recency-boosted contacts above stale frequent ones', () => {
    const store = storeWithMessages()
    const ranked = rankedCorrespondents(store, 'acct_demo', '', 20)
    const emails = ranked.map(contact => contact.email)
    expect(emails).toContain('old@example.com')
    expect(emails).toContain('rina@example.com')
    // 2 recent appearances (score 2*3=6) outrank 4 stale ones (score 4).
    expect(emails.indexOf('rina@example.com')).toBeLessThan(
      emails.indexOf('old@example.com'),
    )
  })

  it('filters by query across name and email and excludes the owner', () => {
    const store = storeWithMessages()
    const byName = rankedCorrespondents(store, 'acct_demo', 'rina')
    expect(byName.map(contact => contact.email)).toEqual(['rina@example.com'])
    const all = rankedCorrespondents(store, 'acct_demo', '', 50)
    expect(all.map(contact => contact.email)).not.toContain(
      'alex@example.com',
    )
  })
})

describe('attachment reminder trigger', () => {
  it('detects attachment mentions', () => {
    expect(bodyMentionsAttachment('I attached the report.')).toBe(true)
    expect(bodyMentionsAttachment('See the PDF for details.')).toBe(true)
    expect(bodyMentionsAttachment('The attachment covers Q3.')).toBe(true)
    expect(bodyMentionsAttachment('Please find the spreadsheet here.')).toBe(
      true,
    )
    expect(bodyMentionsAttachment('Enclosed is the contract.')).toBe(true)
  })

  it('stays quiet for unrelated bodies', () => {
    expect(bodyMentionsAttachment('Let us meet on Tuesday.')).toBe(false)
    expect(bodyMentionsAttachment('')).toBe(false)
    expect(bodyMentionsAttachment('The attaché case was heavy.')).toBe(false)
  })
})

describe('signatures', () => {
  const baseSettings = (): MailSettings =>
    ({
      ...demoMailStore().settings,
      signature: 'Legacy sign-off',
      signatures: undefined,
    }) as MailSettings

  it('falls back to the legacy single signature', () => {
    const signatures = signaturesForAccount(baseSettings(), 'acct_demo')
    expect(signatures).toHaveLength(1)
    expect(signatures[0]).toMatchObject({
      body: 'Legacy sign-off',
      isDefault: true,
    })
  })

  it('scopes named signatures per account and sorts default first', () => {
    let settings = baseSettings()
    settings = upsertSignature(settings, {
      id: 's1',
      accountId: 'acct_demo',
      name: 'Work',
      body: 'Best,\nAdam',
    })
    settings = upsertSignature(settings, {
      id: 's2',
      accountId: 'acct_other',
      name: 'Other account',
      body: 'x',
    })
    settings = upsertSignature(settings, {
      id: 's3',
      name: 'Shared',
      body: 'Cheers',
    })
    const forDemo = signaturesForAccount(settings, 'acct_demo')
    expect(forDemo.map(item => item.id)).toEqual(['s1', 's3'])
    // First signature ever added became the default.
    expect(forDemo[0]?.isDefault).toBe(true)
    expect(defaultSignatureForAccount(settings, 'acct_demo')?.id).toBe('s1')
  })

  it('moves the default when a new default is set and heals on delete', () => {
    let settings = baseSettings()
    settings = upsertSignature(settings, { id: 's1', name: 'A', body: 'a' })
    settings = upsertSignature(settings, {
      id: 's2',
      name: 'B',
      body: 'b',
      isDefault: true,
    })
    expect(
      settings.signatures?.find(item => item.id === 's1')?.isDefault,
    ).toBe(false)
    expect(defaultSignatureForAccount(settings)?.id).toBe('s2')

    settings = removeSignature(settings, 's2')
    expect(defaultSignatureForAccount(settings)?.id).toBe('s1')
    expect(
      settings.signatures?.find(item => item.id === 's1')?.isDefault,
    ).toBe(true)
  })

})

describe('compose html helpers', () => {
  it('escapes hostile text', () => {
    expect(escapeComposeHtml('<img src=x onerror=alert(1)>&"')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;&amp;&quot;',
    )
  })

  it('wraps lines into paragraphs with empty lines preserved', () => {
    expect(plainTextToComposeHtml('Hi\n\nBest,\nAdam')).toBe(
      '<p>Hi</p><p><br></p><p>Best,</p><p>User</p>',
    )
  })
})
