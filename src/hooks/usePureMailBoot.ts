import { useEffect, useRef, useState } from 'react'
import {
  fetchGoogleAccessToken,
  fetchGoogleCredentialStatus,
  networkFetch,
} from '../bridge/platformBridge'
import { DemoMailProvider } from '../lib/demoMailProvider'
import { GmailMailProvider } from '../lib/gmailMailProvider'
import {
  bridgeImapTransport,
  bridgeSmtpTransport,
  ImapMailProvider,
} from '../lib/imapMailProvider'
import {
  imapPasswordSecretKey,
  smtpPasswordSecretKey,
} from '../bridge/platformBridge'
import {
  demoMailStoreForNow,
  emptyMailStore,
  pruneOrphanedDraftThreads,
} from '../lib/mailModel'
import { readPersistedMailStore } from '../lib/mailPersistence'
import type { MailProvider, MailSettings, MailStore } from '../types'

export const PUREMAIL_LOCAL_SETTINGS_KEY = 'puremail.localSettings.v1'

export interface PureMailBootState {
  store: MailStore
  provider: 'demo' | 'gmail' | 'imap'
  mailProvider: MailProvider
  notice?: string
  /**
   * True when the boot rendered the persisted mailbox WITHOUT waiting for
   * the server: the shell owes one startup fetch (`refreshMail('boot')`).
   * Gmail and IMAP boots always; the demo provider never (nothing to fetch).
   */
  syncOnMount?: boolean
  /**
   * Increments each time a boot COMPLETES. The shell remount key must use
   * this, never the reboot request counter: keying on the request counter
   * remounted the shell the instant rebootMail() was called — in the same
   * commit as the caller's setStore — so state batched alongside the reboot
   * (e.g. the just-saved IMAP account) died with the old instance and was
   * then overwritten by the stale mount's settings write.
   */
  bootId: number
}

/**
 * The persisted store, read once per boot and memoised for the rest of it.
 *
 * Reading moved off localStorage onto the shell's filesystem JSON store (see
 * lib/mailPersistence), which makes it async — hence the cached promise: the
 * boot path needs the same answer in three places and must not read the disk
 * three times.
 */
let persistedStoreOnce: Promise<MailStore | null> | null = null

/**
 * Drop the memoised read. Each boot RUN must share one answer, but a reboot
 * (Google connected or disconnected at runtime) must re-read the disk — the
 * disconnect path just persisted a store with the Gmail mirror stripped, and
 * serving the cached pre-disconnect copy would resurrect it.
 */
function invalidatePersistedStoreCache(): void {
  persistedStoreOnce = null
}

async function readPersistedStore(): Promise<MailStore | null> {
  if (!persistedStoreOnce) {
    persistedStoreOnce = readPersistedMailStore()
      .then(({ store }) =>
        // Sweep Drafts-filed threads whose draft is gone. Earlier versions
        // left them behind, so a store can already carry empty Drafts entries
        // that open to "No message selected" and resist every delete.
        store ? pruneOrphanedDraftThreads(store) : null,
      )
      .catch(error => {
        console.warn(
          '[puremail] persisted store unreadable; starting empty:',
          error,
        )
        return null
      })
  }
  return persistedStoreOnce
}

function readPersistedSettings(): Partial<MailSettings> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(PUREMAIL_LOCAL_SETTINGS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<MailSettings> & {
      google?: unknown
    }
    // Google credentials are shell-owned now (Phase 4); drop the legacy
    // settings key so it never round-trips back into persistence.
    delete parsed.google
    return parsed
  } catch (error) {
    console.warn(
      '[puremail] persisted settings unreadable; starting empty:',
      error,
    )
    return {}
  }
}

function applyPersistedSettings(store: MailStore): MailStore {
  return {
    ...store,
    settings: {
      ...store.settings,
      ...readPersistedSettings(),
    },
  }
}

export async function createBootProvider(): Promise<{
  provider: DemoMailProvider | GmailMailProvider | ImapMailProvider
  source: 'demo' | 'gmail' | 'imap'
  notice?: string
}> {
  const demoBoot = async (notice?: string) => {
    // Seed the demo mailbox when there is nothing to show. A persisted store
    // with no threads at all is the same dead end as no store: the demo
    // provider has no server to fetch from, so an empty one stays empty
    // forever with no way for the user to get out of it.
    const persisted = await readPersistedStore()
    const store =
      persisted && persisted.threads.length > 0
        ? persisted
        : demoMailStoreForNow()
    return {
      source: 'demo' as const,
      provider: new DemoMailProvider(applyPersistedSettings(store)),
      ...(notice ? { notice } : {}),
    }
  }
  // A configured, active IMAP-family account (manual IMAP/SMTP, Proton
  // Bridge, Gmail app-password) boots the IMAP provider over the shell's
  // socket transport, and it WINS over a connected Google account.
  //
  // Gmail OAuth used to win here, on the assumption that both described
  // the same mailbox and OAuth was the richer route to it. That is wrong
  // once the Google credential is shared across apps: it is one
  // connection for Mail AND Calendar, so connecting Google merely to see
  // your calendars would silently move your mail off the IMAP account
  // you deliberately activated — a different mailbox entirely. `active`
  // is an explicit user choice; deactivate the account to go back to
  // Gmail.
  const imapAccount = readPersistedSettings().imapAccount
  if (imapAccount?.active) {
    const imapConfig = {
      profileId: imapAccount.profileId,
      imap: imapAccount.imap,
      smtp: imapAccount.smtp,
      username: imapAccount.username,
      passwordSecretKey: imapPasswordSecretKey(imapAccount.profileId),
    }
    // SMTP may carry its own login (Proton Bridge hands out one password
    // per protocol); when none was stored, sending reuses the IMAP secret.
    const smtpConfig = {
      ...imapConfig,
      username: imapAccount.smtpUsername ?? imapAccount.username,
      passwordSecretKey: imapAccount.hasSmtpPassword
        ? smtpPasswordSecretKey(imapAccount.profileId)
        : imapPasswordSecretKey(imapAccount.profileId),
    }
    return {
      source: 'imap',
      provider: new ImapMailProvider({
        email: imapAccount.email,
        name: imapAccount.label,
        imap: bridgeImapTransport(imapConfig),
        smtp: bridgeSmtpTransport(smtpConfig),
        settings: readPersistedSettings(),
      }),
    }
  }
  // Google is irrelevant to an explicitly active IMAP/Proton account.
  // A locked Google credential must not prevent that account from loading.
  let status
  try {
    status = await fetchGoogleCredentialStatus()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return demoBoot(
      `PureMail could not read the Google connection state; showing the demo mailbox. (${message})`,
    )
  }
  if (status.connected) {
    return {
      source: 'gmail',
      provider: new GmailMailProvider({
        ...(status.email ? { email: status.email } : {}),
        settings: readPersistedSettings(),
        fetch: networkFetch,
        accessToken: async () => (await fetchGoogleAccessToken()).accessToken,
      }),
    }
  }
  if (status.needsReconnect) {
    return demoBoot(
      'Google access expired or was revoked. Reconnect in Mail settings → Providers.',
    )
  }
  if (status.configured) {
    return demoBoot(
      'Google is configured but not signed in. Open Mail settings → Providers and sign in with Google to load your Gmail inbox.',
    )
  }
  return demoBoot()
}

export function usePureMailBoot(ready: boolean): {
  boot: PureMailBootState | null
  bootError: Error | null
  /**
   * Bumps on every reboot REQUEST — re-runs the boot effect. Never key UI
   * on this: it changes before the new boot exists (key on boot.bootId).
   */
  generation: number
  /**
   * Re-run the boot provider decision. Called when the provider
   * configuration changes at runtime (e.g. Google connected in Mail
   * settings) so a fresh account activates without an app restart.
   */
  rebootMail: () => void
} {
  const [boot, setBoot] = useState<PureMailBootState | null>(null)
  const [bootError, setBootError] = useState<Error | null>(null)
  const [generation, setGeneration] = useState(0)
  const bootIdRef = useRef(0)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const bootMail = async (): Promise<void> => {
      invalidatePersistedStoreCache()
      const { provider, source, notice: bootNotice } = await createBootProvider()
      // A live account shows the LAST SYNCED mailbox at once and fetches in
      // the background. The boot used to await the whole startup sync
      // first — fifteen seconds of blank frame on a normal inbox, while a
      // 40 MB copy of that very mailbox sat on disk. The shell runs the
      // fetch it owes (`refreshMail('boot')`) with the same merge, notices
      // and failure handling a manual fetch has.
      if (source !== 'demo') {
        const store = applyPersistedSettings(
          (await readPersistedStore()) ?? emptyMailStore(),
        )
        if (cancelled) return
        setBoot({
          store,
          provider: source,
          mailProvider: provider,
          bootId: ++bootIdRef.current,
          syncOnMount: true,
          ...(bootNotice ? { notice: bootNotice } : {}),
        })
        setBootError(null)
        return
      }
      try {
        const fetched = await provider.fetchStore()
        if (cancelled) return
        const store = fetched
        const failedCount = fetched.syncCoverage?.failedCount ?? 0
        setBoot({
          store,
          provider: source,
          mailProvider: provider,
          bootId: ++bootIdRef.current,
          ...(failedCount > 0
            ? {
                notice: `${failedCount} thread${
                  failedCount === 1 ? '' : 's'
                } could not be fetched from Gmail; keeping the local copies.`,
              }
            : bootNotice
            ? { notice: bootNotice }
            : {}),
        })
        setBootError(null)
      } catch (error) {
        if (source === 'demo') throw error
        // A configured account whose startup sync failed (e.g. a transient
        // network outage, or Proton Bridge not yet running) must STAY on its
        // own provider so the next manual or scheduled fetch retries against
        // it. Demoting to the demo provider silently froze the inbox at its
        // last persisted state until reload (this fix previously landed as
        // 31de1ab1 and was lost in the PR #166 merge — do not revert again).
        // `source`, not a hardcoded 'gmail': labelling a failed IMAP boot as
        // gmail made the Google-disconnect watcher read "gmail with no
        // credential" and reboot in a loop whenever the Bridge was down.
        const store = applyPersistedSettings(
          (await readPersistedStore()) ?? emptyMailStore(),
        )
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        console.warn(
          `[puremail] ${source} boot sync failed; will retry:`,
          message,
        )
        setBoot({
          store,
          provider: source,
          mailProvider: provider,
          bootId: ++bootIdRef.current,
          notice: `The mail server was unreachable at startup; showing your last synced mail. Press Fetch mail to retry. (${message})`,
        })
        setBootError(null)
      }
    }
    void bootMail().catch(error => {
      if (cancelled) return
      setBoot(null)
      setBootError(error instanceof Error ? error : new Error(String(error)))
    })
    return () => {
      cancelled = true
    }
  }, [ready, generation])

  return {
    boot,
    bootError,
    generation,
    rebootMail: () => setGeneration(current => current + 1),
  }
}
