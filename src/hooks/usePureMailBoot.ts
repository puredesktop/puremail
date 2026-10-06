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

async function readPersistedStore(): Promise<MailStore | null> {
  const { store } = await readPersistedMailStore()
  return store ? pruneOrphanedDraftThreads(store) : null
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
  } catch {
    console.warn('[puremail] browser settings unavailable; using disk settings.')
    return {}
  }
}

function applyPersistedSettings(store: MailStore, settings: Partial<MailSettings>): MailStore {
  return {
    ...store,
    settings: {
      ...store.settings,
      ...settings,
    },
  }
}

export async function createBootProvider(persistedStore?: MailStore | null): Promise<{
  provider: DemoMailProvider | GmailMailProvider | ImapMailProvider
  source: 'demo' | 'gmail' | 'imap'
  notice?: string
}> {
  const persisted = persistedStore === undefined ? await readPersistedStore() : persistedStore
  const settings = { ...persisted?.settings, ...readPersistedSettings() }
  const demoBoot = async (notice?: string) => {
    // Seed the demo mailbox when there is nothing to show. A persisted store
    // with no threads at all is the same dead end as no store: the demo
    // provider has no server to fetch from, so an empty one stays empty
    // forever with no way for the user to get out of it.
    const store =
      persisted && persisted.threads.length > 0
        ? persisted
        : demoMailStoreForNow()
    return {
      source: 'demo' as const,
      provider: new DemoMailProvider(applyPersistedSettings(store, settings)),
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
  const imapAccount = settings.imapAccount
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
        settings,
      }),
    }
  }
  const gmailBoot = (email?: string, notice?: string) => ({
    source: 'gmail' as const,
    ...(notice ? { notice } : {}),
    provider: new GmailMailProvider({
      ...(email ? { email } : {}), settings, fetch: networkFetch,
      accessToken: async (rejected?: string) => (await fetchGoogleAccessToken(rejected)).accessToken,
    }),
  })
  // Google is irrelevant to an explicitly active IMAP/Proton account.
  // A locked Google credential must not prevent that account from loading.
  let status
  try {
    status = await fetchGoogleCredentialStatus()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const savedGmail = persisted?.accounts.find(account => account.provider === 'gmail')
    if (savedGmail) return gmailBoot(savedGmail.email, `Google connection status is unavailable. Showing saved Gmail; fetch mail to retry. (${message})`)
    return demoBoot(`PureMail could not read the Google connection state. (${message})`)
  }
  if (status.connected || status.needsReconnect) {
    return gmailBoot(status.email, status.needsReconnect
      ? 'Google access expired or was revoked. Showing saved Gmail; reconnect in Mail settings to resume sync.'
      : undefined)
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
      const persisted = await readPersistedStore()
      const settings = { ...persisted?.settings, ...readPersistedSettings() }
      const { provider, source, notice: bootNotice } = await createBootProvider(persisted)
      // A live account shows the LAST SYNCED mailbox at once and fetches in
      // the background. The boot used to await the whole startup sync
      // first — fifteen seconds of blank frame on a normal inbox, while a
      // 40 MB copy of that very mailbox sat on disk. The shell runs the
      // fetch it owes (`refreshMail('boot')`) with the same merge, notices
      // and failure handling a manual fetch has.
      if (source !== 'demo') {
        const store = applyPersistedSettings(
          persisted ?? emptyMailStore(),
          settings,
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
          persisted ?? emptyMailStore(),
          settings,
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
