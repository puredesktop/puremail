/**
 * Is this running copy of the app a second copy, held in a page?
 *
 * A mini app is a second live copy of the app in an iframe, alongside any normal tab of it. Work that must happen once
 * (a scheduled send, the team's drafts, filters, the account sync) belongs to a normal tab, so it asks here first.
 *
 * Two ways of being held, and neither can be told from the other's signal:
 * - Inside the Executive room: the frame sits inside another app's frame, so it knows from its first line.
 * - On the Personal agent's page: the shell hosts the frame itself, exactly as it hosts a tab. Only the shell's answer
 *   says so, which is why the app waits for that answer before it starts anything.
 *
 * Once held, always held: growing to "Full app" over the room is the same copy, and a normal tab may still be open.
 * A question not yet answered reads as held, so nothing starts on a guess.
 */
export interface AdjacentAnswer { heldInRoom?: boolean }

const HELD_ATTRIBUTE = 'data-held-in-room'
const nestedInAnotherApp = (): boolean => typeof window !== 'undefined' && window.parent !== window && window.parent !== window.top
const alone = (): boolean => typeof window === 'undefined' || window.parent === window

let held: boolean | null = alone() ? false : null
let asking: Promise<boolean> | null = null

export const isHeldCopy = (): boolean => held !== false
export const copyIsKnown = (): boolean => held !== null

/** Ask once, for the life of this copy. A shell too old to answer cannot hold apps, so a refusal means a normal tab. */
export function findOutIfHeld(ask: () => Promise<AdjacentAnswer | null | undefined>): Promise<boolean> {
  if (held !== null) return Promise.resolve(held)
  asking ??= ask().catch(() => null).then(answer => {
    const inPage = answer?.heldInRoom === true
    held = nestedInAnotherApp() || inPage
    // Opened straight into its full view, it shows the whole app; it is still a second copy.
    if (typeof document !== 'undefined') document.documentElement.toggleAttribute(HELD_ATTRIBUTE, inPage)
    return held
  })
  return asking
}

/** Tests only: each test is its own running copy. */
export function forgetHeldCopyForTest(): void {
  held = alone() ? false : null
  asking = null
}
