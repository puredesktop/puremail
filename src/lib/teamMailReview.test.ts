import { describe, expect, it } from 'vitest'
import { emptyMailStore } from './mailStoreData'
import { mailShareRoots, readTeamMailReceipts, teamReadStatuses, type TeamMailReceipt } from './teamMailReview'
import type { MailStore } from '../types'
import type { ExecutiveShareFiles } from './executiveShare'

const receipt: TeamMailReceipt = { account: 'team@example.com', reviewer: 'Operations lead', team: 'org.ops', at: '2026-10-26T12:00:00Z', messages: [{ id: '<one@example.com>', threadId: 'thread' }] }
const store: MailStore = { ...emptyMailStore(), accounts: [{ id: 'account', email: receipt.account, name: 'Team', provider: 'imap', syncState: 'online' }], threads: [{ id: 'thread', accountId: 'account', mailboxId: 'inbox', subject: 'Request', participants: [], labels: [], status: 'inbox', priority: 'none', summary: '', lastMessageAt: receipt.at, syncState: 'synced' }], messages: [{ id: 'one', messageIdHeader: '<one@example.com>', threadId: 'thread', from: { name: 'Customer', email: 'customer@example.com' }, to: [], subject: 'Request', body: 'Please help', receivedAt: receipt.at, read: false, attachments: [] }] }

describe('organisation mail review receipts', () => {
  it('discovers organisation folders without a second desktop and retains legacy shares', () => {
    expect(mailShareRoots({ orgs: [{ folder: '/org' }, { folder: '/org/' }, { folder: 'relative' }, null] }, '/workspace')).toEqual(['/workspace', '/org'])
    expect(mailShareRoots(null)).toEqual([])
  })
  it('marks completed review without changing human unread flags; new replies need their own review', () => {
    const before = JSON.stringify(store)
    expect(teamReadStatuses(store, [receipt]).thread).toMatchObject({ label: 'Read by team' })
    expect(teamReadStatuses(store, [receipt]).thread?.description).toContain('Operations lead')
    expect(JSON.stringify(store)).toBe(before)
    const updated = { ...store, messages: [...store.messages, { ...store.messages[0]!, id: 'two', messageIdHeader: '<two@example.com>' }] }
    expect(teamReadStatuses(updated, [receipt]).thread?.label).toBe('Partly read by team')
    expect(updated.messages.every(m => !m.read)).toBe(true)
  })
  it('does not conflate accounts or mark sent-only/draft mail as reviewed', () => {
    expect(teamReadStatuses(store, [{ ...receipt, account: 'other@example.com' }])).toEqual({})
    expect(teamReadStatuses({ ...store, messages: [{ ...store.messages[0]!, isDraft: true }] }, [receipt])).toEqual({})
    expect(teamReadStatuses({ ...store, messages: [{ ...store.messages[0]!, from: { name: 'Me', email: receipt.account } }] }, [receipt])).toEqual({})
  })
  it('accepts only valid receipts for the shared account and never follows a path from a filename', async () => {
    const paths: string[] = []
    const files = {
      list: async () => ['valid.json', 'bad.json', '../outside.json', 'other.json'],
      read: async (path: string) => { paths.push(path); return path.endsWith('/valid.json') ? JSON.stringify({ ...receipt, v: 1 }) : path.endsWith('/other.json') ? JSON.stringify({ ...receipt, v: 1, account: 'other@example.com' }) : '{broken' },
    } as unknown as ExecutiveShareFiles
    expect(await readTeamMailReceipts(files, '/org', receipt.account)).toEqual([receipt])
    expect(paths.some(path => path.includes('..'))).toBe(false)
  })
})
