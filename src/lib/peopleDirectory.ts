import { isStandaloneDevMode } from '../bridge/platformBridge'
import { data } from '@purescience/platform-ui/bridge/apps/data/api'

/**
 * Read-only view of PurePeople's contact book for recipient autocomplete.
 * People holds contacts fed by the WHOLE suite (and curated by the user),
 * so the To/Cc lines can offer names mail traffic alone has not seen —
 * plus curated display names and organisations for the ones it has.
 *
 * Best-effort and cached: recipients must never wait on a bridge call,
 * and a missing People store just means mail-derived suggestions only.
 */
export interface PeopleDirectoryEntry {
  name: string
  email: string
  org?: string
  /** Interaction weight from People (its ranking signal). */
  weight: number
}

const CACHE_TTL_MS = 60_000

let cache: { at: number; entries: PeopleDirectoryEntry[] } | null = null
let inFlight: Promise<PeopleDirectoryEntry[]> | null = null

export function primePeopleDirectory(): void {
  void loadPeopleDirectory()
}

export function cachedPeopleDirectory(): PeopleDirectoryEntry[] {
  return cache?.entries ?? []
}

export async function loadPeopleDirectory(): Promise<PeopleDirectoryEntry[]> {
  if (isStandaloneDevMode()) return []
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.entries
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const records = await data.list<{
        name?: string
        emails?: string[]
        org?: string
        seenCount?: number
      }>('people', 'contacts')
      const entries: PeopleDirectoryEntry[] = []
      for (const { value: contact } of records) {
        for (const email of contact.emails ?? []) {
          if (typeof email !== 'string' || !email.includes('@')) continue
          entries.push({
            name: contact.name?.trim() || email,
            email: email.toLowerCase(),
            ...(contact.org?.trim() ? { org: contact.org.trim() } : {}),
            weight:
              typeof contact.seenCount === 'number' ? contact.seenCount : 0,
          })
        }
      }
      cache = { at: Date.now(), entries }
      return entries
    } catch {
      cache = { at: Date.now(), entries: cache?.entries ?? [] }
      return cache.entries
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
