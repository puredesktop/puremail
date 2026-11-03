import { readPlatformStorageJson, writePlatformStorageJson } from '../bridge/platformBridge'

const storage = { appSlug: 'mail', fileName: 'compose-intents.json' }

/**
 * The addresses PurePeople (or any app) dropped in compose-intents.json, cleared
 * as they are taken. The clearing write applies only if the file is still as
 * read: a request left in between stays queued for the next sweep, not lost.
 */
export async function takeComposeIntents(): Promise<string[]> {
  const read = await readPlatformStorageJson(storage)
  const entries = Object.values(
    (read.value as { entries?: Record<string, { to?: { email?: string }[] }> } | null)?.entries ?? {},
  )
  if (entries.length === 0) return []
  const written = await writePlatformStorageJson({
    ...storage,
    value: { entries: {} },
    ...(read.version !== undefined ? { ifMatch: read.version } : {}),
  })
  if (written.conflict) return []
  return [...new Set(entries.flatMap(entry => (entry.to ?? []).map(recipient => (recipient.email ?? '').trim()).filter(Boolean)))]
}
