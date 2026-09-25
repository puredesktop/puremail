/**
 * The compose window's mode machine. The composer is no longer a boolean:
 * it opens as a small window docked bottom-right over the mail surface
 * ('docked'), can collapse to a 240px title strip ('minimized'), and can
 * pop out to the full-screen compose surface that replaces the content
 * column ('full'). 'closed' means no compose exists at all.
 *
 * Pure so the transition rules are testable without the shell: which modes
 * show a typing surface, which modes still hold a draft-in-progress (and
 * must therefore block compose intents from clobbering it), and what a
 * given Escape press should do.
 */

export type ComposeMode = 'closed' | 'docked' | 'minimized' | 'full'

/**
 * A compose surface the user can type into is on screen. Gates the
 * single-key mail shortcuts (a stray 'e' must never archive the thread
 * behind an open composer) and the focus-the-To-field effect.
 */
export function composeSurfaceVisible(mode: ComposeMode): boolean {
  return mode === 'docked' || mode === 'full'
}

/**
 * A draft-in-progress exists somewhere — visible or minimized. Compose
 * intents (PurePeople's "start an email to X") may only be applied when
 * this is false, so they can never overwrite what the user is writing.
 */
export function composeHoldsDraft(mode: ComposeMode): boolean {
  return mode !== 'closed'
}

/** Opening compose keeps a full-screen composer full; everything else docks. */
export function modeAfterOpenCompose(mode: ComposeMode): ComposeMode {
  return mode === 'full' ? 'full' : 'docked'
}

export type ReplyOpenPlan = 'open' | 'save-draft-then-open'

/**
 * What opening a reply must do to compose state that is already in play.
 * There is ONE compose window; a reply may not silently clobber unsent
 * content the user typed into it. Any unsent content — docked, minimized,
 * full, or left behind by a full-screen Close — is saved to Drafts first
 * (the existing close-saves path) with a notice, then the reply opens. An
 * empty or untouched compose is simply replaced. Content is the ONLY input:
 * the mode never makes typed words safe to discard.
 */
export function replyOpenPlan(hasUnsentContent: boolean): ReplyOpenPlan {
  return hasUnsentContent ? 'save-draft-then-open' : 'open'
}

export type ComposeEscapeAction =
  | 'none'
  | 'close-menus'
  | 'minimize'
  | 'dock'

/**
 * What Escape should do to the composer. Layering rule: anything open
 * INSIDE the window (schedule/signature menu, the link-URL input, the
 * recipient suggestions) closes on the first press; only a press with
 * nothing else open minimizes the docked window. Full-screen Escape
 * returns to the docked window rather than discarding the surface.
 */
export function composeEscapeAction(
  mode: ComposeMode,
  hasOpenLayer: boolean,
): ComposeEscapeAction {
  if (mode === 'full') return 'dock'
  if (mode !== 'docked') return 'none'
  return hasOpenLayer ? 'close-menus' : 'minimize'
}
