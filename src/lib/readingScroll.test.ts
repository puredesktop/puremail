import { describe, expect, it } from 'vitest'
import {
  initialReadingScrollState,
  reduceReadingScroll,
  type ReadingScrollSample,
  type ReadingScrollState,
} from './readingScroll'

/** A tall thread in a normal pane: plenty of room in both directions. */
const TALL = { scrollHeight: 4000, clientHeight: 600 }

function sampleAt(y: number, base = TALL): ReadingScrollSample {
  return { y, ...base }
}

/** Runs a sequence of scrollTop positions through the reducer. */
function run(
  positions: number[],
  state: ReadingScrollState = initialReadingScrollState(),
  base = TALL,
): ReadingScrollState {
  return positions.reduce(
    (current, y) => reduceReadingScroll(current, sampleAt(y, base)),
    state,
  )
}

/** A state parked hidden mid-thread, for return tests. */
function hiddenAt(y: number): ReadingScrollState {
  const state = run([y - 60, y])
  expect(state.hidden).toBe(true)
  return state
}

describe('reduceReadingScroll', () => {
  it('hides once downward travel accumulates past the threshold', () => {
    // Two 20px steps: below threshold after one, past it after two.
    expect(run([20]).hidden).toBe(false)
    expect(run([20, 40]).hidden).toBe(true)
  })

  it('ignores jitter below the threshold in either direction', () => {
    // ±6px wobble around y=200, starting parked with no open account.
    const parked: ReadingScrollState = {
      hidden: false,
      atBottom: false,
      accumulated: 0,
      lastY: 200,
    }
    const wobbled = run(
      [206, 200, 206, 200, 206, 200, 206, 200, 206, 200],
      parked,
    )
    expect(wobbled.hidden).toBe(false)
  })

  it('a direction flip restarts the account — jitter never sums', () => {
    // From a parked position: 20 down, 4 up, 20 down. Total downward travel
    // is 40, but no single run reaches 28, so the dock must stay.
    const parked: ReadingScrollState = {
      hidden: false,
      atBottom: false,
      accumulated: 0,
      lastY: 120,
    }
    const state = run([140, 136, 156], parked)
    expect(state.hidden).toBe(false)
    // A committed run right after does hide it.
    expect(run([176, 196], state).hidden).toBe(true)
  })

  it('stays hidden through small upward jitter', () => {
    const state = hiddenAt(400)
    expect(run([394, 398, 392, 396], state).hidden).toBe(true)
  })

  it('returns after enough accumulated upward travel', () => {
    const state = hiddenAt(400)
    expect(run([386, 370], state).hidden).toBe(false)
  })

  it('returns immediately at the top, regardless of accumulation', () => {
    const state = hiddenAt(400)
    // One hard jump to the top (e.g. Home key): under the topReset line the
    // upward account is irrelevant.
    expect(reduceReadingScroll(state, sampleAt(0)).hidden).toBe(false)
  })

  it('returns on reaching the end of the thread', () => {
    // maxScroll = 3400, slack 40 ⇒ bottom from 3360 up. One continuous
    // downward scroll into the slack band brings the dock back.
    const state = hiddenAt(400)
    const scrolledToEnd = run([1200, 2400, 3370], state)
    expect(scrolledToEnd.atBottom).toBe(true)
    expect(scrolledToEnd.hidden).toBe(false)
  })

  it('never hides while within the bottom slack band', () => {
    // Scrolling around at the very end must not hide the dock: the end of
    // the thread is exactly where replying happens.
    const parked: ReadingScrollState = {
      hidden: false,
      atBottom: true,
      accumulated: 0,
      lastY: 3360,
    }
    expect(run([3380, 3400], parked).hidden).toBe(false)
  })

  it('detects the bottom within the slack band', () => {
    expect(run([3000]).atBottom).toBe(false)
    expect(run([3000, 3360]).atBottom).toBe(true)
    expect(run([3000, 3400]).atBottom).toBe(true)
  })

  it('zero-delta samples change nothing', () => {
    const state = hiddenAt(400)
    const same = reduceReadingScroll(state, sampleAt(400))
    expect(same.hidden).toBe(true)
    expect(same.accumulated).toBe(state.accumulated)
  })
})
