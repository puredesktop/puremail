import { readPlatformStorageJson, writePlatformStorageJson } from '../bridge/platformBridge'
import { parseSweepFile, type ArchiveSweep, type SweepFile } from './archiveSweep'

/** Sweeps keep their own file: a walk of a whole mailbox must not grow the mail store. */
const storage = { appSlug: 'mail', fileName: 'mail-archive-sweeps.json' }

export async function readSweepFile(): Promise<SweepFile> {
  return parseSweepFile((await readPlatformStorageJson(storage)).value)
}

/** The same guard as the triage file: one lock across tabs, then a conditional write for a copy the lock cannot reach. */
export async function updateSweepFile<T>(
  change: (file: SweepFile) => { file: SweepFile; result: T },
): Promise<T> {
  if (!navigator.locks) throw new Error('Safe sweep storage is unavailable')
  return navigator.locks.request('puremail:archive-sweeps', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const read = await readPlatformStorageJson(storage)
      const { file, result } = change(parseSweepFile(read.value))
      const written = await writePlatformStorageJson({
        ...storage,
        value: file,
        ...(read.version !== undefined ? { ifMatch: read.version } : {}),
      })
      if (!written.conflict) return result
    }
    throw new Error('Other copies of Mail kept saving sweeps at the same moment.')
  })
}

export function updateSweep<T>(
  id: string,
  change: (sweep: ArchiveSweep) => { sweep: ArchiveSweep; result: T },
): Promise<T> {
  return updateSweepFile(file => {
    const at = file.sweeps.findIndex(item => item.id === id)
    if (at < 0) throw new Error(`No sweep "${id}". listArchiveSweeps shows them.`)
    const { sweep, result } = change(file.sweeps[at]!)
    const sweeps = [...file.sweeps]
    sweeps[at] = sweep
    return { file: { ...file, sweeps }, result }
  })
}
