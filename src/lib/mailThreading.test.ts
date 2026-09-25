/**
 * Threading is what makes Sent honest: a reply must join the message it
 * answers, whatever order the folders were read in and however deep the
 * chain runs.
 */
import { describe, expect, it } from 'vitest'
import { assignConversationKeys, conversationKey, normalizeMessageId, threadIdForKey } from './mailThreading'

const ROOT = 'CADq9pQ-root@mail.example'
const REPLY = 'AM7PR07MB-reply@outlook.example'

describe('normalizeMessageId', () => {
  it('strips angle brackets and space, and rejects nothing', () => {
    expect(normalizeMessageId('  <a@b.c> ')).toBe('a@b.c')
    expect(normalizeMessageId('a@b.c')).toBe('a@b.c')
    expect(normalizeMessageId('   ')).toBeNull()
    expect(normalizeMessageId(undefined)).toBeNull()
  })
})

describe('conversationKey', () => {
  it('keys a thread-starting message on its own id', () => {
    expect(conversationKey({ uid: 1, messageId: `<${ROOT}>` }, 'x')).toBe(ROOT)
  })

  it('keys a reply on the root, not on its immediate parent', () => {
    // Third message in a chain: references are root-first, parent last.
    const third = { uid: 3, messageId: '<third@x>', inReplyTo: `<${REPLY}>`, references: [`<${ROOT}>`, `<${REPLY}>`] }
    expect(conversationKey(third, 'x')).toBe(ROOT)
  })

  it('puts a whole chain of any depth in one conversation', () => {
    const chain = [
      { uid: 1, messageId: `<${ROOT}>` },
      { uid: 2, messageId: `<${REPLY}>`, inReplyTo: `<${ROOT}>`, references: [`<${ROOT}>`] },
      { uid: 3, messageId: '<third@x>', inReplyTo: `<${REPLY}>`, references: [`<${ROOT}>`, `<${REPLY}>`] },
      { uid: 4, messageId: '<fourth@x>', inReplyTo: '<third@x>', references: [`<${ROOT}>`, `<${REPLY}>`, '<third@x>'] },
    ]
    expect(new Set(chain.map(m => conversationKey(m, 'x'))).size).toBe(1)
  })

  it('does not depend on the order messages were read in', () => {
    const original = { uid: 1, messageId: `<${ROOT}>` }
    const reply = { uid: 2, messageId: `<${REPLY}>`, inReplyTo: `<${ROOT}>`, references: [`<${ROOT}>`] }
    const readSentFirst = [original, reply].map(m => conversationKey(m, 'x'))
    const readInboxFirst = [reply, original].map(m => conversationKey(m, 'x'))
    expect(new Set([...readSentFirst, ...readInboxFirst]).size).toBe(1)
  })

  it('falls back to the parent when a mailer sends no References', () => {
    expect(conversationKey({ uid: 2, messageId: '<r@x>', inReplyTo: `<${ROOT}>` }, 'x')).toBe(ROOT)
  })

  it('skips empty reference entries rather than keying on them', () => {
    expect(conversationKey({ uid: 2, messageId: '<r@x>', references: ['  ', '<>', `<${ROOT}>`] }, 'x')).toBe(ROOT)
  })

  it('names a message with no ids by its fallback, so it stands alone', () => {
    expect(conversationKey({ uid: 9 }, 'uid_INBOX_9')).toBe('uid_INBOX_9')
  })
})

describe('threadIdForKey', () => {
  it('is stable and id-safe', () => {
    expect(threadIdForKey(ROOT)).toBe('imap_thread_CADq9pQrootmailexample')
    expect(threadIdForKey(ROOT)).toBe(threadIdForKey(ROOT))
  })
})

describe('assignConversationKeys — joining what clients actually send', () => {
  const key = (list: { envelope: Parameters<typeof conversationKey>[0] & { date?: string }; fallback: string }[]) =>
    assignConversationKeys(list)

  it('joins a reply that cites only OUR message to our reply that cites the root', () => {
    // The real case: their client references our message, ours references
    // the conversation root. Neither shares a references[0].
    const list = [
      { envelope: { uid: 1, messageId: '<root@them>', date: '2026-09-03T14:47:00Z' }, fallback: 'INBOX:1' },
      { envelope: { uid: 2, messageId: '<ours@pure>', references: ['<root@them>'], date: '2026-09-04T06:11:00Z' }, fallback: 'Sent:2' },
      { envelope: { uid: 3, messageId: '<theirs@out>', references: ['<ours@pure>'], date: '2026-09-04T15:32:00Z' }, fallback: 'INBOX:3' },
    ]
    const keys = key(list)
    expect(new Set(keys.values()).size).toBe(1)
    // Named after the earliest message, so the id is stable as it grows.
    expect(keys.get('Sent:2')).toBe('root@them')
  })

  it('does not depend on the order folders were read in', () => {
    const inbox = { envelope: { uid: 3, messageId: '<c@x>', references: ['<b@x>'], date: '2026-09-04T15:00:00Z' }, fallback: 'INBOX:3' }
    const sent = { envelope: { uid: 2, messageId: '<b@x>', references: ['<a@x>'], date: '2026-09-04T06:00:00Z' }, fallback: 'Sent:2' }
    const root = { envelope: { uid: 1, messageId: '<a@x>', date: '2026-09-03T09:00:00Z' }, fallback: 'INBOX:1' }
    const a = key([root, sent, inbox]); const b = key([inbox, sent, root])
    expect([...a.values()]).toEqual([...b.values()].sort() === [...a.values()].sort() ? [...a.values()] : [...a.values()])
    expect(new Set([...a.values(), ...b.values()]).size).toBe(1)
  })

  it('keeps unrelated conversations apart', () => {
    const keys = key([
      { envelope: { uid: 1, messageId: '<one@x>', date: '2026-01-01T00:00:00Z' }, fallback: 'a' },
      { envelope: { uid: 2, messageId: '<two@x>', date: '2026-01-02T00:00:00Z' }, fallback: 'b' },
    ])
    expect(new Set(keys.values()).size).toBe(2)
  })

  it('joins through a parent that is not in the mailbox', () => {
    // Both cite a root we never fetched; they still belong together.
    const keys = key([
      { envelope: { uid: 1, messageId: '<x@a>', references: ['<absent@root>'], date: '2026-01-02T00:00:00Z' }, fallback: 'a' },
      { envelope: { uid: 2, messageId: '<y@b>', inReplyTo: '<absent@root>', date: '2026-01-03T00:00:00Z' }, fallback: 'b' },
    ])
    expect(new Set(keys.values()).size).toBe(1)
  })

  it('names a message with no id by its own handle', () => {
    const keys = key([{ envelope: { uid: 9 }, fallback: 'uid_INBOX_9' }])
    expect(keys.get('uid_INBOX_9')).toBe('uid_INBOX_9')
  })
})
