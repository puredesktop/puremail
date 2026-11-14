import { describe, expect, it } from 'vitest'
import { demoMailStore } from '../test/mailFixtures'
import { THREAD_LINK_PREFIX, threadLinkTarget } from './threadLink'

const store = demoMailStore()
const message = store.messages.find(each => !each.isDraft)!
const link = (...parts: string[]): string => THREAD_LINK_PREFIX + parts.map(encodeURIComponent).join('/')

describe('a link to one mail', () => {
  it('is not this kind of link', () => {
    expect(threadLinkTarget(store, 'purescience://mail/draft/x')).toBeNull()
    expect(threadLinkTarget(store, '/Users/me/file.pdf')).toBeNull()
  })

  it('opens its thread, on its message', () => {
    expect(threadLinkTarget(store, link(message.threadId))).toEqual({ threadId: message.threadId, messageId: null })
    expect(threadLinkTarget(store, link(message.threadId, message.id))).toEqual({ threadId: message.threadId, messageId: message.id })
  })

  it('takes the Message-ID the digest shares, with its brackets', () => {
    const header = '<abc/1@example.com>'
    const tagged = { ...store, messages: store.messages.map(each => (each.id === message.id ? { ...each, messageIdHeader: header } : each)) }
    expect(threadLinkTarget(tagged, link(message.threadId, header))).toEqual({ threadId: message.threadId, messageId: message.id })
  })

  it('finds a thread since renumbered by its message', () => {
    expect(threadLinkTarget(store, link('an-old-thread-id', message.id))).toEqual({ threadId: message.threadId, messageId: message.id })
  })

  it('does not point at a message of another thread', () => {
    const other = store.threads.find(each => each.id !== message.threadId)!
    expect(threadLinkTarget(store, link(other.id, message.id))).toEqual({ threadId: other.id, messageId: null })
  })

  it('says so when it is not on this desktop, or the link is broken', () => {
    expect(threadLinkTarget(store, link('gone', 'gone-too'))).toEqual({ notice: 'This mail is not in PureMail on this desktop.' })
    expect(threadLinkTarget(store, `${THREAD_LINK_PREFIX}%E0%A4%A`)).toEqual({ notice: 'This mail is not in PureMail on this desktop.' })
  })
})
