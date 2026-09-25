/**
 * Reply-dock visibility while reading a thread.
 *
 * The reading chrome follows the native scroll-away pattern: the search band
 * and the standalone subject row are part of the scrollable flow and leave
 * the screen like content, the toolbar is sticky from load, and the slim
 * sender line rides a zero-height sticky anchor — none of that needs scroll
 * math. The one piece that still needs a DECISION is the reply dock: a
 * bottom overlay that hides on committed downward scroll and returns on
 * committed upward scroll, at the top, or when reading reaches the end of
 * the thread. That decision lives here as a pure reducer over scroll
 * samples so the flap-prone part — hysteresis — is unit-testable without a
 * DOM. (No dock is mounted yet: today's reader opens its composer as a
 * full-pane surface. The logic is settled and tested here for the dock to
 * consume when it lands.)
 *
 * Hysteresis is by ACCUMULATED one-direction travel, not a positional
 * boundary: a single y-threshold flickers when a scroll parks on it, and
 * trackpad jitter (±a few px per frame) must never flip the dock. A
 * direction flip restarts the account, so jitter cannot sum to the
 * threshold over time.
 */

export interface ReadingScrollThresholds {
  /** Accumulated downward px before the dock hides. */
  hide: number
  /** Accumulated upward px before the dock returns. */
  show: number
  /** At or under this scrollTop the dock is always shown. */
  topReset: number
  /** Within this many px of the end counts as "reached the bottom". */
  bottomSlack: number
}

export const READING_SCROLL_THRESHOLDS: ReadingScrollThresholds = {
  hide: 28,
  show: 28,
  topReset: 8,
  bottomSlack: 40,
}

/** One scroll event's measurements, taken by the component. */
export interface ReadingScrollSample {
  /** scrollTop of the reader's scroll container. */
  y: number
  scrollHeight: number
  clientHeight: number
}

export interface ReadingScrollState {
  /** True while the dock is scrolled away. */
  hidden: boolean
  /** True once the scroll position has reached the end of the content. */
  atBottom: boolean
  /**
   * Signed px of travel committed in the current direction (positive =
   * down). Reset whenever the direction flips.
   */
  accumulated: number
  lastY: number
}

export function initialReadingScrollState(): ReadingScrollState {
  return { hidden: false, atBottom: false, accumulated: 0, lastY: 0 }
}

export function reduceReadingScroll(
  state: ReadingScrollState,
  sample: ReadingScrollSample,
  thresholds: ReadingScrollThresholds = READING_SCROLL_THRESHOLDS,
): ReadingScrollState {
  const delta = sample.y - state.lastY
  // Same direction extends the account; a flip restarts it at this event's
  // travel. Zero-delta events (resize-triggered) change nothing.
  const accumulated =
    delta === 0
      ? state.accumulated
      : state.accumulated === 0 || delta > 0 === state.accumulated > 0
        ? state.accumulated + delta
        : delta

  const atBottom =
    sample.y + sample.clientHeight >=
    sample.scrollHeight - thresholds.bottomSlack

  let hidden = state.hidden
  if (hidden) {
    // Any of the three return conditions ends the hide: back at the top,
    // reading reached the end, or a committed upward run.
    if (
      sample.y <= thresholds.topReset ||
      atBottom ||
      accumulated <= -thresholds.show
    ) {
      hidden = false
    }
  } else if (
    accumulated >= thresholds.hide &&
    sample.y > thresholds.topReset &&
    // Hiding the dock at the end of the thread would remove it at the one
    // place it is guaranteed wanted.
    !atBottom
  ) {
    hidden = true
  }

  return { hidden, atBottom, accumulated, lastY: sample.y }
}
