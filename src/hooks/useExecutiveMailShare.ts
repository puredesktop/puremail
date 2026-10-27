import { useEffect, useRef, useState } from 'react'
import { getPlatformPreferences } from '@purescience/platform-ui/bridge/preferences'
import {
  readPlatformStorageJson,
  fsDelete,
  fsListNames,
  fsReadTextIfPresent,
  fsRenameInFolder,
  fsWriteText,
} from '../bridge/platformBridge'
import {
  readMailShare,
  sharedAccount,
  takeExecutiveDrafts,
  writeMailDigest,
  type DraftImportResult,
  type ExecutiveDraftRequest,
  type ExecutiveShareFiles,
} from '../lib/executiveShare'
import { mailShareRoots, readTeamMailReceipts, teamReadStatuses, type TeamMailReceipt, type TeamReadStatuses } from '../lib/teamMailReview'
import type { MailAccount, MailStore } from '../types'

const shellFiles: ExecutiveShareFiles = {
  read: fsReadTextIfPresent,
  write: fsWriteText,
  list: fsListNames,
  rename: fsRenameInFolder,
  remove: fsDelete,
}

/**
 * The executive team's mail share (lib/executiveShare.ts holds the rules).
 *
 * Present only when the Executive app has written share.json in this
 * workspace and it names the connected account. After each successful sync
 * it appends the new messages to the digest; after each sync and when Mail
 * opens it takes the drafts the team left, as DRAFTS. No model, no network
 * call of its own, and no path to sending.
 *
 * Looks never overlap within a window; across windows the file claims in
 * the lib keep them apart.
 */
export function useExecutiveMailShare(input: {
  /** False for the demo mailbox: no connected account, nothing shared. */
  enabled: boolean
  readStore: () => MailStore
  saveDraft: (account: MailAccount, request: ExecutiveDraftRequest) => { draftId: string }
  onDraftsTaken?: (result: DraftImportResult) => void
}): {
  /** Call after a successful sync, with the accounts that sync covered. */
  afterSync: (syncedAccounts: MailAccount[]) => void
  teamReads: TeamReadStatuses
} {
  const [receipts, setReceipts] = useState<TeamMailReceipt[]>([])
  const inputRef = useRef(input)
  inputRef.current = input
  const instanceId = useRef(Math.random().toString(36).slice(2, 10) || 'window')
  const tail = useRef<Promise<void>>(Promise.resolve())

  const look = useRef((syncedAccounts: MailAccount[] | null) => {
    tail.current = tail.current.then(async () => {
      const current = inputRef.current
      if (!current.enabled) return
      try {
        const root = (await getPlatformPreferences()).workspaceRoot?.trim()
        const settings = await readPlatformStorageJson({ appSlug: 'executive', fileName: 'executive.json' }).catch(() => ({ value: null }))
        const allReceipts: TeamMailReceipt[] = []
        for (const folder of mailShareRoots(settings.value, root)) {
          try {
            const share = await readMailShare(shellFiles, folder)
            if (!share) continue
            const account = sharedAccount(current.readStore(), share)
            if (!account) continue
            // Cached synced messages bootstrap a newly configured share too. Cursor deduplication is durable.
            const synced = syncedAccounts ? sharedAccount({ accounts: syncedAccounts }, share) : account
            if (synced) await writeMailDigest({ files: shellFiles, root: folder, store: current.readStore(), share, account: synced, instanceId: instanceId.current })
            allReceipts.push(...await readTeamMailReceipts(shellFiles, folder, account.email))
            const result = await takeExecutiveDrafts({ files: shellFiles, root: folder, share, instanceId: instanceId.current, save: request => inputRef.current.saveDraft(account, request) })
            if (result.taken.length || result.refused.length) inputRef.current.onDraftsTaken?.(result)
          } catch { console.warn('[puremail] An organisation mail share could not be refreshed; it will retry.') }
        }
        setReceipts(previous => JSON.stringify(previous) === JSON.stringify(allReceipts) ? previous : allReceipts)
      } catch (error) {
        // The share is a side channel: a failed look must never disturb mail.
        // The next sync looks again; the files say what was and was not done.
        console.warn('[puremail] executive mail share:', error)
      }
    })
  })

  // "On open": take any drafts left while Mail was closed.
  useEffect(() => {
    if (!input.enabled) return
    const timer = window.setTimeout(() => look.current(null), 0)
    const poll = window.setInterval(() => look.current(null), 30_000)
    return () => { window.clearTimeout(timer); window.clearInterval(poll) }
  }, [input.enabled])

  return { afterSync: syncedAccounts => look.current(syncedAccounts), teamReads: teamReadStatuses(input.readStore(), receipts) }
}
