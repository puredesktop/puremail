import { describe, expect, it } from 'vitest'
import {
  draftAgentRefs,
  filterAgentRefs,
  mailboxAgentRefs,
  readingAgentRefs,
  runItemAgentRefs,
  threadAgentRefs,
} from './agentRefs'

const tags = (props: { 'data-agent-ref': string }): string[] => props['data-agent-ref'].split(' ')

describe('agent activity refs', () => {
  it('names a thread the way the thread tools pass it, plus its unsent drafts', () => {
    const props = threadAgentRefs({ id: 't1', subject: 'Invoice' }, ['d1'])
    expect(tags(props)).toEqual(expect.arrayContaining(['t1', 'id:t1', 'threadId:t1', 'threadIds:t1', 'd1', 'draftId:d1']))
    expect(props['data-agent-label']).toBe('Invoice')
  })

  it('names a draft by every argument that carries a draft id', () => {
    expect(tags(draftAgentRefs({ id: 'd1', subject: '' }))).toEqual(['d1', 'id:d1', 'draftId:d1', 'draftIds:d1', 'templateDraftId:d1'])
  })

  it('names a run item by draft id and its 1-based row', () => {
    expect(tags(runItemAgentRefs({ draftId: 'd2', rowIndex: 0, label: 'Mere' }))).toEqual(
      expect.arrayContaining(['d2', 'draftId:d2', 'row:1']),
    )
  })

  it('names a box, a filter and a read message', () => {
    expect(tags(mailboxAgentRefs({ name: 'git' }))).toEqual(['git', 'box:git', 'mailboxName:git', 'name:git'])
    expect(tags(filterAgentRefs({ id: 'f1', name: 'News' }))).toEqual(
      expect.arrayContaining(['f1', 'filter:f1', 'News', 'filter:News', 'name:News']),
    )
    expect(tags(readingAgentRefs({ messageId: 'm1', threadId: 't1', subject: 'Hi' }))).toEqual(
      expect.arrayContaining(['m1', 'messageId:m1', 'threadId:t1']),
    )
  })
})
