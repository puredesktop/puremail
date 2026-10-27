import type { MailStore } from '../types'
import type { ExecutiveShareFiles } from './executiveShare'

export interface TeamMailReceipt {
  account: string
  reviewer: string
  team: string
  at: string
  messages: Array<{ id: string; threadId: string }>
}
export interface TeamReadStatus { label: string; description: string }
export type TeamReadStatuses = Record<string, TeamReadStatus>

/** Existing workspace shares remain supported; configured organisations use their own folders. */
export function mailShareRoots(settings: unknown, workspaceRoot?: string): string[] {
  const value = settings as { orgs?: Array<{ folder?: unknown }> } | null
  const folders = Array.isArray(value?.orgs) ? value.orgs.map(org => org?.folder) : []
  return [...new Set([workspaceRoot, ...folders].filter((root): root is string => typeof root === 'string' && /^(\/|[A-Za-z]:[\\/])/.test(root.trim())).map(root => root.trim().replace(/[\\/]$/, '')))]
}

export async function readTeamMailReceipts(files: ExecutiveShareFiles, root: string, account: string): Promise<TeamMailReceipt[]> {
  const folder = `${root}/.appdata/executive/mail/reviews`
  const receipts: TeamMailReceipt[] = []
  for (const name of await files.list(folder).catch(() => [])) {
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) continue
    try {
      const receipt = JSON.parse(await files.read(`${folder}/${name}`) ?? 'null')
      if (receipt?.v !== 1 || typeof receipt.account !== 'string' || receipt.account.toLowerCase() !== account.toLowerCase() || typeof receipt.reviewer !== 'string' || typeof receipt.team !== 'string' || !Number.isFinite(Date.parse(receipt.at)) || !Array.isArray(receipt.messages)) continue
      receipts.push({ account: receipt.account, reviewer: receipt.reviewer, team: receipt.team, at: receipt.at, messages: receipt.messages.filter((m: { id?: unknown; threadId?: unknown } | null) => typeof m?.id === 'string' && typeof m?.threadId === 'string') })
    } catch { /* A partial/invalid receipt is not evidence of review. */ }
  }
  return receipts
}

/** A projection only: never touches human read flags or any provider API. New replies reopen review. */
export function teamReadStatuses(store: MailStore, receipts: TeamMailReceipt[]): TeamReadStatuses {
  const reviewed = new Map<string, TeamMailReceipt>()
  for (const receipt of receipts) for (const message of receipt.messages) {
    const key = `${receipt.account.toLowerCase()}\n${message.id}`
    const previous = reviewed.get(key)
    if (!previous || receipt.at > previous.at) reviewed.set(key, receipt)
  }
  const accounts = new Map(store.accounts.map(account => [account.id, account.email.toLowerCase()]))
  const threads = new Map(store.threads.map(thread => [thread.id, accounts.get(thread.accountId)]))
  const counts = new Map<string, { total: number; reviewed: number; last?: TeamMailReceipt }>()
  for (const message of store.messages) {
    const account = threads.get(message.threadId)
    if (!account || message.isDraft || message.optimistic || message.from.email.toLowerCase() === account) continue
    const count = counts.get(message.threadId) ?? { total: 0, reviewed: 0 }
    count.total++
    const receipt = reviewed.get(`${account}\n${message.messageIdHeader?.trim() || message.id}`)
    if (receipt) {
      count.reviewed++
      if (!count.last || receipt.at > count.last.at) count.last = receipt
    }
    counts.set(message.threadId, count)
  }
  return Object.fromEntries([...counts].filter(([, count]) => count.last).map(([id, count]) => [id, {
    label: count.reviewed === count.total ? 'Read by team' : 'Partly read by team',
    description: `${count.reviewed} of ${count.total} received messages reviewed. ${count.last!.reviewer} · ${new Date(count.last!.at).toLocaleString()}. Your unread status is unchanged.`,
  }]))
}
