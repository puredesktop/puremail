import { describe, expect, it } from 'vitest'
import {
  askEntriesNewestFirst,
  askSessionBusy,
  askSessionForThread,
  beginAsk,
  emptyAskSession,
  failAsk,
  isStaleAsk,
  resolveAsk,
} from './askSession'

describe('ask session', () => {
  it('records a pending entry and reports busy', () => {
    const { session, ref } = beginAsk(emptyAskSession('t1'), 'what is this?')

    expect(session.entries).toHaveLength(1)
    expect(session.entries[0]).toMatchObject({
      question: 'what is this?',
      status: 'pending',
    })
    expect(ref).toEqual({ threadId: 't1', entryId: 'ask-1' })
    expect(askSessionBusy(session)).toBe(true)
  })

  it('settles an answer onto its own entry', () => {
    const started = beginAsk(emptyAskSession('t1'), 'what is this?')
    const done = resolveAsk(started.session, started.ref, 'An invoice.')

    expect(done.entries[0]).toMatchObject({
      answer: 'An invoice.',
      status: 'answered',
    })
    expect(askSessionBusy(done)).toBe(false)
  })

  it('marks failures as failed rather than as an answer', () => {
    const started = beginAsk(emptyAskSession('t1'), 'q')
    const done = failAsk(started.session, started.ref, 'Agent unavailable.')

    // The UI keys off status to style errors differently; an error that
    // arrives as status 'answered' would be indistinguishable from a real
    // response, which is the bug this guards.
    expect(done.entries[0].status).toBe('failed')
  })

  it('keeps earlier answers when a follow-up is asked', () => {
    const first = beginAsk(emptyAskSession('t1'), 'first')
    const answered = resolveAsk(first.session, first.ref, 'one')
    const second = beginAsk(answered, 'second')

    expect(second.session.entries).toHaveLength(2)
    expect(second.session.entries[0].answer).toBe('one')
    expect(second.ref.entryId).not.toBe(first.ref.entryId)
  })

  it('shows the newest entry first', () => {
    const first = beginAsk(emptyAskSession('t1'), 'first')
    const second = beginAsk(first.session, 'second')

    expect(askEntriesNewestFirst(second.session).map(e => e.question)).toEqual([
      'second',
      'first',
    ])
  })
})

describe('thread scoping', () => {
  it('drops the transcript when the thread changes', () => {
    const started = beginAsk(emptyAskSession('t1'), 'q')
    const answered = resolveAsk(started.session, started.ref, 'a')

    const switched = askSessionForThread(answered, 't2')

    expect(switched.threadId).toBe('t2')
    expect(switched.entries).toEqual([])
  })

  it('keeps the transcript when the thread is unchanged', () => {
    const started = beginAsk(emptyAskSession('t1'), 'q')
    expect(askSessionForThread(started.session, 't1')).toBe(started.session)
  })

  it('discards a response that arrives after a thread switch', () => {
    // The bug: ask on t1, switch to t2, t1's promise resolves. Clearing state
    // on switch is not enough on its own — the in-flight promise still lands.
    const started = beginAsk(emptyAskSession('t1'), 'about thread one')
    const switched = askSessionForThread(started.session, 't2')

    const afterLateResponse = resolveAsk(
      switched,
      started.ref,
      "thread one's answer",
    )

    expect(isStaleAsk(switched, started.ref)).toBe(true)
    expect(afterLateResponse).toBe(switched)
    expect(afterLateResponse.entries).toEqual([])
  })

  it('discards a late failure just as it discards a late answer', () => {
    const started = beginAsk(emptyAskSession('t1'), 'q')
    const switched = askSessionForThread(started.session, 't2')

    expect(failAsk(switched, started.ref, 'boom')).toBe(switched)
  })

  it('does not confuse entries between two threads with the same entry id', () => {
    // Both sessions issue 'ask-1'; only the matching thread may accept it.
    const t1 = beginAsk(emptyAskSession('t1'), 'q')
    const t2 = beginAsk(emptyAskSession('t2'), 'q')

    expect(isStaleAsk(t2.session, t1.ref)).toBe(true)
    expect(resolveAsk(t2.session, t1.ref, 'wrong thread')).toBe(t2.session)
    expect(resolveAsk(t2.session, t2.ref, 'right thread').entries[0].answer).toBe(
      'right thread',
    )
  })
})
