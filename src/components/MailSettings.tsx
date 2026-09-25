import { AppSettingsPages } from '@purescience/platform-bridge/components/settings/AppSettings'
import { TypedTriageSettings } from './TypedTriageSettings'
import {
  runMailFilters,
  addMailFilter,
  deleteMailFilter,
  ensureMailLabel,
  setMailFilterEnabled,
  suggestMailFilters,
} from '../lib/mailFilters'
import { quoteQueryValue, saveMailView } from '../lib/mailQuery'
import { Fragment, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { Badge } from '@purescience/platform-ui/components/common/feedback/Badge'
import { ProviderConnection } from '@purescience/platform-ui/components/common/connections/ProviderConnection'
import { GMAIL_SCOPES } from '@purescience/platform-ui/bridge/googleAuth'
import type { OAuthCredentialStatus } from '@purescience/platform-ui/bridge/credentials.mjs'
import {
  GOOGLE_CREDENTIAL_ID,
  disconnectGoogleCredential,
  fetchGoogleCredentialStatus,
  forgetConnectionPasswords,
  saveImapPassword,
  saveSmtpPassword,
} from '../bridge/platformBridge'
import {
  IMAP_ACCOUNT_PRESETS,
  validateImapAccountInput,
  type ImapSecurity,
} from '../lib/imapMailProvider'
import { mailCommands } from '../lib/mailCommands'
import { removeSignature, upsertSignature } from '../lib/mailCompose'
import { notificationsMuted } from '../lib/mailNotifications'
import {
  setRemoteImagePolicy,
  untrustSender,
} from '../lib/remoteImagePolicy'
import { defaultMailNotificationPreferences } from '../lib/mailStoreMigration'
import {
  autoFetchEnabledForStore,
  followUpSettingsForStore,
  mailFetchIntervalMinutesForStore,
  mailFetchWindowForStore,
  removeProviderAccountData,
} from '../lib/mailModel'
import type {
  MailAccount,
  MailFetchIntervalMinutes,
  MailFetchWindow,
  MailConnectionProfile,
  MailSignature,
  MailStore,
} from '../types'
import {
  ComposeInput,
  ComposeLabel,
  ComposeTextArea,
  ConnectionButtonRow,
  ConnectionDetailHeader,
  ConnectionDetailMeta,
  ConnectionFieldLabel,
  ConnectionFieldPair,
  ConnectionFormLegend,
  ConnectionFormSection,
  ConnectionOptionBadge,
  ConnectionOptionCard,
  ConnectionOptionGrid,
  ConnectionOptionHeader,
  ConnectionPanel,
  ConnectionPanelText,
  ConnectionPanelTitle,
  ConnectionResultList,
  ConnectionResultTitle,
  ConnectionSavedCard,
  ConnectionSetupGrid,
  ConnectionSetupIntro,
  ConnectionSetupPage,
  ConnectionStepItem,
  ConnectionStepList,
  ConnectionStepNumber,
  ConnectionTestResultBox,
  InstructionRiskList,
  InstructionRiskPanel,
  Meta,
  SelectField,
  SettingToggle,
  SettingsActions,
  SettingsCard,
  SettingsCardHeader,
  SettingsDrawer,
  SettingsDrawerBackdrop,
  SettingsDrawerBody,
  SettingsDrawerHeader,
  SettingsFullRow,
  SettingsOptionGrid,
  SignatureListRow,
  ShortcutKey,
  ShortcutList,
  ShortcutMeaning,
  Subject,
  TaskField,
  type ConnectionResultTone,
  type MailProviderOptionStatus,
} from './mailShellStyles'
import {
  assessAiInstructionRisks,
  formatDate,
  type PendingInstructionSave,
} from './mailShellHelpers'

/**
 * The connectors on offer before release: Gmail (OAuth and app-password),
 * manual IMAP/SMTP, and Proton Mail via Bridge. iCloud, Fastmail, Yahoo/AOL,
 * Outlook/Graph, BYO-OAuth and JMAP were removed 2026-08-19 rather than
 * shipped as promises — each is a support surface, and none is committed for
 * this release. Their catalog copy lives in git history (this commit's
 * parent) for when one earns its way back.
 */
type MailProviderOptionId =
  | 'gmail-oauth'
  | 'gmail-app-password'
  | 'generic-imap-smtp'
  | 'proton-bridge'
type ConnectionTestResult = {
  tone: ConnectionResultTone
  title: string
  message: string
  nextSteps?: string[]
}

const GOOGLE_MAIL_SETUP_STEPS = [
  {
    title: 'Create or reuse a Google OAuth desktop client',
    detail:
      'Use the Gmail scopes for mail read, compose, send, labels, and message actions.',
  },
  {
    title: 'Save OAuth settings',
    detail:
      'PureMail keeps readable settings here while the shell vault stores secret material.',
  },
  {
    title: 'Connect Gmail',
    detail:
      'Google opens in the browser and returns here after approval. Nothing is sent automatically.',
  },
]

const GOOGLE_MAIL_DEFAULTS = [
  {
    title: 'Empty local workspace remains available',
    detail:
      'PureMail falls back to an empty local workspace when Gmail is disconnected or sync fails.',
  },
  {
    title: 'Provider setup is shared',
    detail:
      'Configure Google once in PureMail or PureCalendar; both apps receive the same client setup.',
  },
  {
    title: 'Explicit actions only',
    detail:
      'Drafts, archive, labels, and send flows still require visible user action.',
  },
]

const MAIL_PROVIDER_OPTIONS: Array<{
  id: MailProviderOptionId
  title: string
  description: string
  meta: string
  badge: string
  status: MailProviderOptionStatus
  steps: Array<{ title: string; detail: string }>
  defaultsTitle: string
  defaults: string
}> = [
  {
    id: 'gmail-oauth',
    title: 'Gmail sign-in',
    description:
      'Best PureMail path today. Sync Gmail inbox threads, prepare replies, and approve sends.',
    meta: 'Browser sign-in · no mail password',
    badge: 'works now',
    status: 'ready',
    steps: GOOGLE_MAIL_SETUP_STEPS,
    defaultsTitle: 'What this connection enables',
    defaults:
      'PureMail can fetch Gmail inbox threads and use Gmail for archive, unarchive, trash, unread, search, and reply sends. An empty local workspace remains the fallback.',
  },
  {
    id: 'gmail-app-password',
    title: 'Gmail app password',
    description:
      'Gmail over IMAP/SMTP with an app password — no OAuth client needed.',
    meta: 'Needs Google two-step verification',
    badge: 'works now',
    status: 'ready',
    steps: [
      {
        title: 'Create an app password in Google',
        detail:
          'Use Google account security to create an app password for desktop mail clients.',
      },
      {
        title: 'Save it in the vault',
        detail:
          'PureMail should keep only visible server settings here while the shell vault stores the password.',
      },
      {
        title: 'Use IMAP and SMTP',
        detail:
          'This path is planned for the local mail engine without requiring Google OAuth review.',
      },
    ],
    defaultsTitle: 'Known defaults',
    defaults:
      'Incoming imap.gmail.com:993 SSL · Outgoing smtp.gmail.com:587 STARTTLS.',
  },
  {
    id: 'generic-imap-smtp',
    title: 'Manual IMAP and SMTP',
    description:
      'For hosted mail, work accounts, and providers that publish standard server settings.',
    meta: 'Most flexible · more technical',
    badge: 'works now',
    status: 'ready',
    steps: [
      {
        title: 'Enter incoming mail settings',
        detail:
          'Add the IMAP host, port, and encryption style your provider documents.',
      },
      {
        title: 'Enter outgoing mail settings',
        detail:
          'Add the SMTP host, port, and encryption style used for sending.',
      },
      {
        title: 'Save the credential separately',
        detail:
          'The account password or app password belongs in the shell vault.',
      },
    ],
    defaultsTitle: 'Known defaults',
    defaults:
      'Manual providers vary. PureMail can store readable host/port/security settings once this connector is active.',
  },
  {
    id: 'proton-bridge',
    title: 'Proton Mail Bridge',
    description:
      'Connects to the local Bridge app instead of directly to Proton servers.',
    meta: 'Local bridge app required',
    badge: 'works now',
    status: 'ready',
    steps: [
      {
        title: 'Run Proton Bridge',
        detail:
          'Bridge keeps Proton encryption local and exposes IMAP/SMTP on localhost.',
      },
      {
        title: 'Copy the IMAP settings from Bridge',
        detail:
          'Bridge shows an IMAP host, port, username, and its own generated password.',
      },
      {
        title: 'Copy the SMTP settings from Bridge',
        detail:
          'SMTP has its own port and password in Bridge — paste them into the outgoing section separately.',
      },
    ],
    defaultsTitle: 'Known defaults',
    defaults:
      'Typical local defaults are 127.0.0.1:1143 IMAP and 127.0.0.1:1025 SMTP, prefilled below. Each protocol keeps its own password.',
  },
]

export interface MailSettingsProps {
  onRunTriage: (ids?:string[],options?:import('../lib/typedTriage').TriageRunOptions) => Promise<import('../lib/typedTriage').TriageRunSummary>
  /** Reboot the mail provider decision after an IMAP account is saved. */
  onImapConnected?: () => void
  store: MailStore
  setStore: React.Dispatch<React.SetStateAction<MailStore>>
  setCommandNotice: React.Dispatch<React.SetStateAction<string>>
  selectedAccount: MailAccount | null
  googleStatus: OAuthCredentialStatus | null
  setGoogleStatus: React.Dispatch<
    React.SetStateAction<OAuthCredentialStatus | null>
  >
  providerDrawerOpen: boolean
  setProviderDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  mailFetching: boolean
  refreshMail: (trigger?: 'manual' | 'auto') => Promise<void>
  replayQueuedActionsNow: () => Promise<void>
  discardQueuedActionNow: (actionId: string) => void
  /** Fire filter-engine remote mutations through the live provider. */
  fireFilterMutations?: (
    mutations: readonly import('../lib/mailFilters').MailFilterMutation[],
  ) => void
}

/**
 * Nav entries, one per rendered card. Keep in step with the `id` on each
 * SettingsCard: an entry with no matching card scrolls nowhere, and a card
 * with no entry is unreachable from the nav.
 */
export const SETTINGS_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['Accounts & providers', 'settings-accounts'],
  ['Fetching & inbox', 'settings-fetching'],
  ['Filters', 'settings-filters'],
  ['Automatic triage', 'settings-typed-triage'],
  ['Reply assistance', 'settings-compose'],
  ['Offline changes', 'settings-offline-queue'],
  ['Signatures', 'settings-signatures'],
  ['Shortcuts', 'settings-shortcuts'],
]

const SETTINGS_HELP: Record<string, string> = {
  'settings-accounts': 'Connect and manage mail accounts. Google access is shared with Calendar; passwords and tokens stay in the shell vault.',
  'settings-fetching': 'Choose when to check for mail, how much history to fetch, and how the inbox handles images and notifications.',
  'settings-filters': 'Create rules that organise incoming messages. Review a rule before applying it to existing mail.',
  'settings-typed-triage': 'Choose how new mail is classified and prioritised. These preferences guide automatic triage.',
  'settings-compose': 'Set reply suggestions, follow-ups, and composition preferences.',
  'settings-offline-queue': 'Review changes waiting to sync. Retry or discard individual queued actions.',
  'settings-signatures': 'Create signatures and choose which accounts use them. Signatures are added to new drafts.',
  'settings-shortcuts': 'Use these keyboard commands while browsing mail. They are inactive while you type in an editor.',
}

export function MailSettings({
  onRunTriage,
  onImapConnected,
  store,
  setStore,
  setCommandNotice,
  selectedAccount,
  googleStatus,
  setGoogleStatus,
  providerDrawerOpen,
  setProviderDrawerOpen,
  mailFetching,
  refreshMail,
  replayQueuedActionsNow,
  discardQueuedActionNow,
  fireFilterMutations,
}: MailSettingsProps): React.ReactElement {
  const [providerTestResult, setProviderTestResult] =
    useState<ConnectionTestResult | null>(null)
  const [editingProfile, setEditingProfile] = useState<MailConnectionProfile | null>(null)
  const [savingAccount, setSavingAccount] = useState(false)
  const [imapForm, setImapForm] = useState({
    presetId: '',
    email: '',
    imapUsername: '',
    imapPassword: '',
    imapHost: '',
    imapPort: '993',
    imapSecurity: 'ssl' as ImapSecurity,
    smtpUsername: '',
    smtpPassword: '',
    smtpHost: '',
    smtpPort: '587',
    smtpSecurity: 'starttls' as ImapSecurity,
  })
  const patchImapForm = (
    patch: Partial<typeof imapForm>,
  ): void => setImapForm(current => ({ ...current, ...patch }))
  const applyImapPreset = (presetId: string): void => {
    const preset =
      IMAP_ACCOUNT_PRESETS.find(item => item.id === presetId) ??
      IMAP_ACCOUNT_PRESETS.find(item => item.id === 'generic')!
    setImapForm(current => ({
      ...current,
      presetId: preset.id,
      imapHost: preset.imapHost,
      imapPort: String(preset.imapPort),
      imapSecurity: preset.imapSecurity,
      smtpHost: preset.smtpHost,
      smtpPort: String(preset.smtpPort),
      smtpSecurity: preset.smtpSecurity,
    }))
  }
  const saveImapAccountSetup = (): void => {
    if (savingAccount) return
    const providerOptionId = selectedMailProviderId
    const email = imapForm.email.trim()
    const imapUsername = imapForm.imapUsername.trim() || email
    const smtpUsername = imapForm.smtpUsername.trim() || imapUsername
    const errors = validateImapAccountInput({
      email,
      username: imapUsername,
      imapHost: imapForm.imapHost,
      imapPort: Number(imapForm.imapPort),
      smtpHost: imapForm.smtpHost,
      smtpPort: Number(imapForm.smtpPort),
    })
    if (errors.length > 0) {
      setProviderTestResult({
        tone: 'warning',
        title: 'Fix the account settings first.',
        message: errors.join(' '),
      })
      return
    }
    // One saved profile per (connector kind, address): re-saving updates in
    // place, and a Proton Bridge profile never collides with a plain IMAP
    // one for the same address.
    const shape =
      providerOptionId === 'proton-bridge'
        ? {
            idPrefix: 'proton',
            provider: 'proton-bridge' as const,
            mode: 'bridge' as const,
            description:
              'Proton Mail via local Bridge over the shell socket transport.',
          }
        : providerOptionId === 'gmail-app-password'
          ? {
              idPrefix: 'gmailimap',
              provider: 'gmail-app-password' as const,
              mode: 'app-password' as const,
              description:
                'Gmail over IMAP/SMTP via the shell socket transport.',
            }
          : {
              idPrefix: 'imap',
              provider: 'imap-smtp' as const,
              mode: 'manual' as const,
              description:
                'IMAP/SMTP account over the shell socket transport.',
            }
    const profileId = editingProfile?.id ?? `${shape.idPrefix}_${email.toLowerCase()}`
    const hasSmtpPassword = Boolean(imapForm.smtpPassword) || Boolean(
      editingProfile && (editingProfile.hasSmtpPassword ||
        (store.settings.imapAccount?.profileId === profileId && store.settings.imapAccount.hasSmtpPassword)),
    )
    const account = {
      profileId,
      label: email,
      email,
      username: imapUsername,
      imap: {
        host: imapForm.imapHost.trim(),
        port: Number(imapForm.imapPort),
        security: imapForm.imapSecurity,
      },
      smtp: {
        host: imapForm.smtpHost.trim(),
        port: Number(imapForm.smtpPort),
        security: imapForm.smtpSecurity,
      },
      ...(smtpUsername !== imapUsername ? { smtpUsername } : {}),
      hasSmtpPassword,
      active: true,
    }
    const persistAccount = (): void => {
      setStore(current => ({
        ...current,
        settings: {
          ...current.settings,
          imapAccount: account,
          connectionProfiles: [
            ...(current.settings.connectionProfiles ?? []).filter(
              profile => profile.id !== profileId,
            ),
            {
              id: profileId,
              email,
              hasSmtpPassword,
              provider: shape.provider,
              label: account.label,
              mode: shape.mode,
              status: 'ready',
              description: shape.description,
              endpoint: {
                imap: { ...account.imap, username: imapUsername },
                smtp: { ...account.smtp, username: smtpUsername },
              },
            } satisfies MailConnectionProfile,
          ],
        },
      }))
    }
    if (!imapForm.imapPassword) {
      setProviderTestResult({
        tone: 'warning',
        title: 'IMAP password needed.',
        message:
          'Enter the incoming (IMAP) password — it is stored OS-encrypted and read only by the shell when connecting.',
      })
      return
    }
    // Passwords go to the OS-encrypted secrets store FIRST; only stored
    // passwords make the account worth activating. A keystore that cannot
    // encrypt refuses the save rather than writing plaintext. SMTP gets its
    // own key when provided (Proton Bridge hands out one password per
    // protocol); otherwise sending reuses the IMAP one.
    setSavingAccount(true)
    const passwordSaves = [saveImapPassword(profileId, imapForm.imapPassword)]
    if (imapForm.smtpPassword) {
      passwordSaves.push(saveSmtpPassword(profileId, imapForm.smtpPassword))
    }
    void Promise.all(passwordSaves)
      .then(() => {
        persistAccount()
        setImapForm(current => ({
          ...current,
          imapPassword: '',
          smtpPassword: '',
        }))
        setProviderTestResult({
          tone: 'success',
          title: 'Account saved — connecting.',
          message:
            (hasSmtpPassword
              ? 'Both passwords are stored OS-encrypted, one per protocol; the shell reads them when dialing.'
              : 'The password is stored OS-encrypted and read by the shell when dialing; sending reuses it until a separate SMTP password is saved.') +
            ' PureMail is rebooting onto this account now.',
        })
        onImapConnected?.()
      })
      .catch(error => {
        setProviderTestResult({
          tone: 'warning',
          title: 'Password not stored.',
          message:
            error instanceof Error
              ? `${error.message} The account was not activated.`
              : 'The password could not be stored safely; the account was not activated.',
        })
      })
      .finally(() => setSavingAccount(false))
  }
  const editConnectionProfile = (profile: MailConnectionProfile): void => {
    const account = store.settings.imapAccount?.profileId === profile.id
      ? store.settings.imapAccount : undefined
    const imap = account?.imap ?? profile.endpoint?.imap
    const smtp = account?.smtp ?? profile.endpoint?.smtp
    setEditingProfile(profile)
    setSelectedMailProviderId(profile.provider === 'proton-bridge'
      ? 'proton-bridge' : profile.provider === 'gmail-app-password'
        ? 'gmail-app-password' : 'generic-imap-smtp')
    setProviderTestResult(null)
    setImapForm({
      presetId: profile.provider,
      email: account?.email ?? profile.email ?? profile.label,
      imapUsername: account?.username ?? profile.endpoint?.imap?.username ?? '',
      smtpUsername: account?.smtpUsername ?? profile.endpoint?.smtp?.username ?? account?.username ?? '',
      imapPassword: '', smtpPassword: '',
      imapHost: imap?.host ?? '', imapPort: String(imap?.port ?? 993),
      imapSecurity: imap?.security ?? 'ssl',
      smtpHost: smtp?.host ?? '', smtpPort: String(smtp?.port ?? 587),
      smtpSecurity: smtp?.security ?? 'starttls',
    })
    setProviderDrawerOpen(true)
  }
  /**
   * Remove a saved connection: profile, stored passwords, and — when it is
   * the ACTIVE IMAP account — its account activation and synced local
   * mirror, followed by a reboot back to whatever provider remains.
   */
  const removeConnectionProfile = (profileId: string): void => {
    const wasActiveImapAccount =
      store.settings.imapAccount?.profileId === profileId
    setStore(current => {
      const { imapAccount } = current.settings
      const settings = {
        ...current.settings,
        // Deactivate EXPLICITLY (active: false), never by dropping the key:
        // settings merge by object spread in several places (boot overlays
        // localStorage onto the disk store's settings), and a spread cannot
        // express deletion — a removed key came back from the stale disk
        // copy on the next boot.
        ...(imapAccount?.profileId === profileId
          ? { imapAccount: { ...imapAccount, active: false } }
          : {}),
        connectionProfiles: (
          current.settings.connectionProfiles ?? []
        ).filter(profile => profile.id !== profileId),
      }
      const next = { ...current, settings }
      return imapAccount?.profileId === profileId
        ? removeProviderAccountData(next, 'imap')
        : next
    })
    void forgetConnectionPasswords(profileId)
    setCommandNotice(
      wasActiveImapAccount
        ? 'Account deactivated — connection, passwords, and the synced copy were removed.'
        : 'Connection removed; its stored passwords were deleted.',
    )
    if (wasActiveImapAccount) onImapConnected?.()
  }
  const [gmailDisconnecting, setGmailDisconnecting] = useState(false)
  /**
   * Deactivate Gmail: drop the shell-side tokens, then strip the synced
   * Gmail mirror from the local store. The shell watcher in PureMailShell
   * sees the status change, flushes, and reboots into the local workspace.
   */
  const disconnectGmail = async (): Promise<void> => {
    setGmailDisconnecting(true)
    try {
      await disconnectGoogleCredential()
      const status = await fetchGoogleCredentialStatus()
      setGoogleStatus(status)
      setStore(current => removeProviderAccountData(current, 'gmail'))
      setCommandNotice(
        'Gmail disconnected — the synced copy was removed from this device.',
      )
      setProviderDrawerOpen(false)
    } catch (error) {
      setCommandNotice(
        `Gmail could not be disconnected: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    } finally {
      setGmailDisconnecting(false)
    }
  }
  const notificationPreferences =
    store.notificationPreferences ?? defaultMailNotificationPreferences()
  const patchNotificationPreferences = (
    patch: Partial<typeof notificationPreferences>,
  ): void => {
    setStore(current => ({
      ...current,
      notificationPreferences: {
        ...(current.notificationPreferences ??
          defaultMailNotificationPreferences()),
        ...patch,
      },
    }))
  }
  const queuedActions = store.queuedActions ?? []
  const accountSignatures = (store.settings.signatures ?? []).filter(
    signature =>
      !signature.accountId || signature.accountId === selectedAccount?.id,
  )
  const [selectedMailProviderId, setSelectedMailProviderId] =
    useState<MailProviderOptionId | null>(null)
  const syncedGoogleAccountEmail =
    store.accounts.find(account => account.provider === 'gmail')?.email ??
    (selectedAccount?.provider === 'gmail' ? selectedAccount.email : '')
  const googleConnectionEmail =
    syncedGoogleAccountEmail || googleStatus?.email || 'No account connected'
  const googleConnectionState = googleStatus?.connected
    ? 'connected'
    : googleStatus?.needsReconnect
      ? 'reconnect required'
      : googleStatus?.configured
        ? 'configured'
        : 'not configured'
  const googleStatusCopy = googleStatus?.connected
    ? `Gmail connected as ${googleConnectionEmail}. PureMail syncs Gmail inbox threads when the app starts.`
    : googleStatus?.needsReconnect
      ? 'Google access expired or was revoked. Reconnect to resume Gmail sync.'
      : googleStatus?.configured
        ? 'Google OAuth client saved. Sign in with Google when you are ready.'
        : 'Connect a Google account before Gmail can sync.'
  const selectedMailProvider = selectedMailProviderId
    ? MAIL_PROVIDER_OPTIONS.find(
        provider => provider.id === selectedMailProviderId,
      ) ?? null
    : null
  const selectMailProvider = (
    providerId: MailProviderOptionId | null,
  ): void => {
    setEditingProfile(null)
    setImapForm(current => ({ ...current, imapPassword: '', smtpPassword: '' }))
    setSelectedMailProviderId(providerId)
    setProviderTestResult(null)
    // Opening a fixed-server connector page seeds its preset once;
    // re-entering keeps whatever the user already typed. The generic page
    // is never reseeded — its preset dropdown is the user's own choice.
    const presetId =
      providerId === 'proton-bridge' || providerId === 'gmail-app-password'
        ? providerId
        : null
    if (presetId) {
      setImapForm(current =>
        current.presetId === presetId
          ? current
          : {
              ...current,
              presetId,
              ...(() => {
                const preset = IMAP_ACCOUNT_PRESETS.find(
                  item => item.id === presetId,
                )!
                return {
                  imapHost: preset.imapHost,
                  imapPort: String(preset.imapPort),
                  imapSecurity: preset.imapSecurity,
                  smtpHost: preset.smtpHost,
                  smtpPort: String(preset.smtpPort),
                  smtpSecurity: preset.smtpSecurity,
                }
              })(),
            },
      )
    }
  }

  const followUpSettings = followUpSettingsForStore(store)
  const mailFetchWindow = mailFetchWindowForStore(store)
  const autoFetchEnabled = autoFetchEnabledForStore(store)
  const mailFetchIntervalMinutes = mailFetchIntervalMinutesForStore(store)
  const quotedHistoryOpenByDefault =
    store.settings.quotedHistoryOpenByDefault ?? false
  const trustedImageSenders = store.settings.remoteImages?.trustedSenders ?? []
  const [draftingInstructionsInput, setDraftingInstructionsInput] = useState(
    store.settings.replyDraftingInstructions ?? '',
  )
  const [pendingInstructionSave, setPendingInstructionSave] =
    useState<PendingInstructionSave | null>(null)
  const persistDraftingInstructions = (value: string): void => {
    const trimmed = value.trim()
    setStore(current => ({
      ...current,
      settings: {
        ...current.settings,
        replyDraftingInstructions: trimmed || undefined,
      },
    }))
    setPendingInstructionSave(null)
    setCommandNotice(
      trimmed
        ? 'Reply drafting instructions saved.'
        : 'Reply drafting instructions cleared — the built-in defaults apply.',
    )
  }
  /**
   * The save boundary for AI instructions: assess first, and when anything
   * looks like it weakens a product guardrail, show the risks and require an
   * explicit confirm before persisting. Clean instructions save straight
   * through.
   */
  const saveDraftingInstructions = (): void => {
    const risks = assessAiInstructionRisks('drafting', draftingInstructionsInput)
    if (risks.length === 0) {
      persistDraftingInstructions(draftingInstructionsInput)
      return
    }
    setPendingInstructionSave({
      target: 'drafting',
      value: draftingInstructionsInput,
      risks,
    })
  }
  const notificationsMutedNow = notificationsMuted(notificationPreferences)
  const muteNotifications = (option: 'off' | 'hour' | 'tomorrow'): void => {
    if (option === 'off') {
      patchNotificationPreferences({ mutedUntil: undefined })
      return
    }
    const until = new Date()
    if (option === 'hour') {
      until.setHours(until.getHours() + 1)
    } else {
      until.setDate(until.getDate() + 1)
      until.setHours(8, 0, 0, 0)
    }
    patchNotificationPreferences({ mutedUntil: until.toISOString() })
  }
  const updateFollowUpSettings = (
    patch: Partial<NonNullable<MailStore['settings']['followUp']>>,
  ): void => {
    setStore(current => ({
      ...current,
      settings: {
        ...current.settings,
        followUp: {
          ...followUpSettingsForStore(current),
          ...patch,
        },
      },
    }))
  }

  return (
    <AppSettingsPages pages={SETTINGS_SECTIONS.map(([label, id]) => ({ id, label, description: SETTINGS_HELP[id] }))}>
            <div id="settings-typed-triage"><TypedTriageSettings store={store} setStore={setStore} onRunTriage={onRunTriage} /></div>
            <SettingsCard id="settings-accounts">
              <SettingsCardHeader>
                <div>
                  <Subject>Accounts</Subject>
                  <Meta>
                    {selectedAccount?.name ?? 'Demo account'} ·{' '}
                    {selectedAccount?.email ?? 'No account email'}
                  </Meta>
                </div>
                <Badge tone="neutral">
                  {selectedAccount?.provider ?? 'demo'}
                </Badge>
              </SettingsCardHeader>
              <SettingsCardHeader>
                <div>
                  <ConnectionDetailMeta>
                    Provider setup
                  </ConnectionDetailMeta>
                  <Subject>Google Gmail</Subject>
                  <Meta>
                    {googleStatusCopy} Other mail connection options are
                    available in the setup drawer.
                  </Meta>
                </div>
                <Badge tone={googleStatus?.connected ? 'accent' : 'neutral'}>
                  {googleConnectionState}
                </Badge>
              </SettingsCardHeader>
              <ConnectionSavedCard>
                <div>
                  <ConnectionResultTitle>
                    {googleConnectionEmail}
                  </ConnectionResultTitle>
                  <Meta>
                    Browser sign-in · no mail password · secrets stay in the
                    shell vault
                  </Meta>
                </div>
                <ConnectionButtonRow>
                  <Button
                    size="sm"
                    onClick={() => {
                      selectMailProvider('gmail-oauth')
                      setProviderDrawerOpen(true)
                    }}
                  >
                    Configure Gmail
                  </Button>
                  {(googleStatus?.connected ||
                    googleStatus?.needsReconnect) && (
                    <Button
                      size="sm"
                      variant="subtle"
                      disabled={gmailDisconnecting}
                      onClick={() => void disconnectGmail()}
                    >
                      {gmailDisconnecting
                        ? 'Disconnecting…'
                        : 'Disconnect'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => {
                      selectMailProvider(null)
                      setProviderDrawerOpen(true)
                    }}
                  >
                    Browse options
                  </Button>
                </ConnectionButtonRow>
              </ConnectionSavedCard>
              {store.settings.imapAccount?.active && (
                <ConnectionSavedCard>
                  <div>
                    <ConnectionResultTitle>
                      {store.settings.imapAccount.label}
                    </ConnectionResultTitle>
                    <Meta>
                      Active IMAP account · IMAP{' '}
                      {store.settings.imapAccount.imap.host}:
                      {store.settings.imapAccount.imap.port} · SMTP{' '}
                      {store.settings.imapAccount.smtp.host}:
                      {store.settings.imapAccount.smtp.port}
                    </Meta>
                  </div>
                  <ConnectionButtonRow>
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() =>
                        removeConnectionProfile(
                          store.settings.imapAccount!.profileId,
                        )
                      }
                    >
                      Deactivate
                    </Button>
                  </ConnectionButtonRow>
                </ConnectionSavedCard>
              )}
              {(store.settings.connectionProfiles ?? []).length > 0 && (
                <>
                  <SettingsCardHeader>
                    <div>
                      <ConnectionDetailMeta>
                        Saved connections
                      </ConnectionDetailMeta>
                      <Meta>
                        IMAP/SMTP setups stored on this device. Removing one
                        also deletes its vault passwords.
                      </Meta>
                    </div>
                  </SettingsCardHeader>
                  {(store.settings.connectionProfiles ?? []).map(profile => {
                    // "Which one is actually in use?" — the row must say so.
                    // Boot precedence: an ACTIVE IMAP account wins, because
                    // activating one is an explicit choice; Google is live
                    // when no IMAP account is active (the Google credential
                    // is shared with Calendar, so being connected does not
                    // by itself mean "read my mail here").
                    const imapIsLive =
                      store.settings.imapAccount?.active === true
                    const isActive =
                      profile.provider === 'google'
                        ? googleStatus?.connected === true && !imapIsLive
                        : imapIsLive &&
                          store.settings.imapAccount?.profileId === profile.id
                    return (
                    <ConnectionSavedCard key={profile.id}>
                      <div>
                        <ConnectionResultTitle>
                          {profile.label}{' '}
                          {isActive && <Badge tone="accent">active</Badge>}
                        </ConnectionResultTitle>
                        <Meta>
                          {profile.provider}
                          {profile.endpoint?.imap?.host
                            ? ` · IMAP ${profile.endpoint.imap.host}:${
                                profile.endpoint.imap.port ?? '—'
                              }`
                            : ''}
                          {profile.endpoint?.smtp?.host
                            ? ` · SMTP ${profile.endpoint.smtp.host}:${
                                profile.endpoint.smtp.port ?? '—'
                              }`
                            : ''}
                        </Meta>
                      </div>
                      <ConnectionButtonRow>
                        {profile.endpoint?.imap && profile.endpoint?.smtp && (
                          <Button size="sm" variant="subtle"
                            aria-label={`Edit ${profile.label}`} title="Edit connection"
                            disabled={savingAccount}
                            onClick={() => editConnectionProfile(profile)}>
                            <Pencil size={16} aria-hidden="true" /> Edit
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() =>
                            removeConnectionProfile(profile.id)
                          }
                        >
                          Remove
                        </Button>
                      </ConnectionButtonRow>
                    </ConnectionSavedCard>
                    )
                  })}
                </>
              )}
            </SettingsCard>

            {providerDrawerOpen && (
              <SettingsDrawerBackdrop
                onClick={() => setProviderDrawerOpen(false)}
              >
                <SettingsDrawer
                  role="dialog"
                  aria-modal="true"
                  aria-label="Mail connection setup"
                  onClick={event => event.stopPropagation()}
                >
                  <SettingsDrawerHeader>
                    <div>
                      <Subject>{editingProfile ? 'Edit mail connection' : 'Mail connections'}</Subject>
                      <Meta>
                        Choose a provider, test it, and keep secrets in the
                        shell vault.
                      </Meta>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setProviderDrawerOpen(false)}
                    >
                      Close
                    </Button>
                  </SettingsDrawerHeader>
                  <SettingsDrawerBody>
                    <ConnectionSetupPage aria-label="Mail provider setup drawer">
                      <ConnectionSetupIntro>
                        <div>
                          <ConnectionDetailMeta>
                            Provider setup
                          </ConnectionDetailMeta>
                          <Subject>
                            {selectedMailProvider?.title ??
                              'Mail connections'}
                          </Subject>
                          <Meta>
                            {selectedMailProvider
                              ? selectedMailProvider.description
                              : 'Choose a provider, save only readable settings here, and let the shell vault hold secrets.'}
                          </Meta>
                        </div>
                        <Badge
                          tone={
                            googleStatus?.connected ? 'accent' : 'neutral'
                          }
                        >
                          {googleConnectionState}
                        </Badge>
                      </ConnectionSetupIntro>

                      {selectedMailProvider ? (
                        <>
                          <ConnectionSetupGrid>
                            <ConnectionPanel>
                              <ConnectionDetailHeader>
                                <div>
                                  <ConnectionDetailMeta>
                                    Mail setup
                                  </ConnectionDetailMeta>
                                  <ConnectionPanelTitle>
                                    {selectedMailProvider.title}
                                  </ConnectionPanelTitle>
                                  <ConnectionPanelText>
                                    {selectedMailProvider.description}
                                  </ConnectionPanelText>
                                </div>
                                <Button
                                  size="sm"
                                  variant="subtle"
                                  onClick={() => selectMailProvider(null)}
                                >
                                  All options
                                </Button>
                              </ConnectionDetailHeader>

                              <ConnectionStepList
                                aria-label={`${selectedMailProvider.title} setup steps`}
                              >
                                {selectedMailProvider.steps.map(
                                  (step, index) => (
                                    <ConnectionStepItem key={step.title}>
                                      <ConnectionStepNumber>
                                        {index + 1}
                                      </ConnectionStepNumber>
                                      <div>
                                        <ConnectionResultTitle>
                                          {step.title}
                                        </ConnectionResultTitle>
                                        <Meta>{step.detail}</Meta>
                                      </div>
                                    </ConnectionStepItem>
                                  ),
                                )}
                              </ConnectionStepList>

                              {selectedMailProvider.id === 'gmail-oauth' ? (
                                <ProviderConnection
                                  credentialId={GOOGLE_CREDENTIAL_ID}
                                  title="Google account"
                                  description="One Google connection shared by Mail and Calendar."
                                  scopes={GMAIL_SCOPES}
                                  onStatusChange={setGoogleStatus}
                                />
                              ) : (
                                <>
                                  {selectedMailProvider.id ===
                                  'generic-imap-smtp' ? (
                                    <ConnectionFieldPair>
                                      <ConnectionFieldLabel>
                                        Email address
                                        <input
                                          aria-label="Email address"
                                          value={imapForm.email}
                                          onChange={event =>
                                            patchImapForm({
                                              email:
                                                event.currentTarget.value,
                                            })
                                          }
                                        />
                                      </ConnectionFieldLabel>
                                      <ConnectionFieldLabel>
                                        Server preset
                                        <SelectField
                                          aria-label="Server preset"
                                          value={imapForm.presetId}
                                          onChange={event =>
                                            applyImapPreset(
                                              event.currentTarget.value,
                                            )
                                          }
                                        >
                                          <option value="">
                                            Server preset…
                                          </option>
                                          {IMAP_ACCOUNT_PRESETS.map(
                                            preset => (
                                              <option
                                                key={preset.id}
                                                value={preset.id}
                                              >
                                                {preset.label}
                                              </option>
                                            ),
                                          )}
                                        </SelectField>
                                      </ConnectionFieldLabel>
                                    </ConnectionFieldPair>
                                  ) : (
                                    <ConnectionFieldLabel>
                                      Email address
                                      <input
                                        aria-label="Email address"
                                        value={imapForm.email}
                                        onChange={event =>
                                          patchImapForm({
                                            email: event.currentTarget.value,
                                          })
                                        }
                                      />
                                    </ConnectionFieldLabel>
                                  )}
                                  <ConnectionFormSection>
                                    <ConnectionFormLegend>
                                      Incoming mail — IMAP
                                    </ConnectionFormLegend>
                                    <ConnectionFieldPair>
                                      <ConnectionFieldLabel>
                                        IMAP host
                                        <input
                                          aria-label="Incoming mail host"
                                          value={imapForm.imapHost}
                                          onChange={event =>
                                            patchImapForm({
                                              imapHost:
                                                event.currentTarget.value,
                                            })
                                          }
                                        />
                                      </ConnectionFieldLabel>
                                      <ConnectionFieldLabel>
                                        Port
                                        <input
                                          aria-label="Incoming mail port"
                                          inputMode="numeric"
                                          value={imapForm.imapPort}
                                          onChange={event =>
                                            patchImapForm({
                                              imapPort:
                                                event.currentTarget.value,
                                            })
                                          }
                                        />
                                      </ConnectionFieldLabel>
                                    </ConnectionFieldPair>
                                    <ConnectionFieldPair>
                                      <ConnectionFieldLabel>
                                        IMAP username
                                        <input
                                          aria-label="IMAP username"
                                          placeholder="Defaults to the email address"
                                          value={imapForm.imapUsername}
                                          onChange={event =>
                                            patchImapForm({
                                              imapUsername:
                                                event.currentTarget.value,
                                            })
                                          }
                                        />
                                      </ConnectionFieldLabel>
                                      <ConnectionFieldLabel>
                                        Security
                                        <SelectField
                                          aria-label="Incoming mail security"
                                          value={imapForm.imapSecurity}
                                          onChange={event =>
                                            patchImapForm({
                                              imapSecurity: event
                                                .currentTarget
                                                .value as ImapSecurity,
                                            })
                                          }
                                        >
                                          <option value="ssl">SSL/TLS</option>
                                          <option value="starttls">
                                            STARTTLS
                                          </option>
                                          <option value="none">None</option>
                                        </SelectField>
                                      </ConnectionFieldLabel>
                                    </ConnectionFieldPair>
                                    <ConnectionFieldLabel>
                                      IMAP password
                                      <input
                                        aria-label="IMAP password"
                                        type="password"
                                        placeholder={
                                          selectedMailProvider.id ===
                                          'proton-bridge'
                                            ? 'Password shown under IMAP in Bridge'
                                            : 'App password or provider password'
                                        }
                                        value={imapForm.imapPassword}
                                        onChange={event =>
                                          patchImapForm({
                                            imapPassword:
                                              event.currentTarget.value,
                                          })
                                        }
                                      />
                                    </ConnectionFieldLabel>
                                  </ConnectionFormSection>
                                  <ConnectionFormSection>
                                    <ConnectionFormLegend>
                                      Outgoing mail — SMTP
                                    </ConnectionFormLegend>
                                    <ConnectionFieldPair>
                                      <ConnectionFieldLabel>
                                        SMTP host
                                        <input
                                          aria-label="Outgoing mail host"
                                          value={imapForm.smtpHost}
                                          onChange={event =>
                                            patchImapForm({
                                              smtpHost:
                                                event.currentTarget.value,
                                            })
                                          }
                                        />
                                      </ConnectionFieldLabel>
                                      <ConnectionFieldLabel>
                                        Port
                                        <input
                                          aria-label="Outgoing mail port"
                                          inputMode="numeric"
                                          value={imapForm.smtpPort}
                                          onChange={event =>
                                            patchImapForm({
                                              smtpPort:
                                                event.currentTarget.value,
                                            })
                                          }
                                        />
                                      </ConnectionFieldLabel>
                                    </ConnectionFieldPair>
                                    <ConnectionFieldPair>
                                      <ConnectionFieldLabel>
                                        SMTP username
                                        <input
                                          aria-label="SMTP username"
                                          placeholder="Defaults to the IMAP username"
                                          value={imapForm.smtpUsername}
                                          onChange={event =>
                                            patchImapForm({
                                              smtpUsername:
                                                event.currentTarget.value,
                                            })
                                          }
                                        />
                                      </ConnectionFieldLabel>
                                      <ConnectionFieldLabel>
                                        Security
                                        <SelectField
                                          aria-label="Outgoing mail security"
                                          value={imapForm.smtpSecurity}
                                          onChange={event =>
                                            patchImapForm({
                                              smtpSecurity: event
                                                .currentTarget
                                                .value as ImapSecurity,
                                            })
                                          }
                                        >
                                          <option value="ssl">SSL/TLS</option>
                                          <option value="starttls">
                                            STARTTLS
                                          </option>
                                          <option value="none">None</option>
                                        </SelectField>
                                      </ConnectionFieldLabel>
                                    </ConnectionFieldPair>
                                    <ConnectionFieldLabel>
                                      SMTP password
                                      <input
                                        aria-label="SMTP password"
                                        type="password"
                                        placeholder={
                                          editingProfile?.hasSmtpPassword || (editingProfile && store.settings.imapAccount?.profileId === editingProfile.id && store.settings.imapAccount.hasSmtpPassword)
                                            ? 'Leave blank to keep the saved SMTP password'
                                            : selectedMailProvider.id ===
                                          'proton-bridge'
                                            ? 'Password shown under SMTP in Bridge'
                                            : 'Empty reuses the IMAP password'
                                        }
                                        value={imapForm.smtpPassword}
                                        onChange={event =>
                                          patchImapForm({
                                            smtpPassword:
                                              event.currentTarget.value,
                                          })
                                        }
                                      />
                                    </ConnectionFieldLabel>
                                  </ConnectionFormSection>
                                  <ConnectionButtonRow>
                                    <Button
                                      size="sm"
                                      onClick={saveImapAccountSetup}
                                      disabled={savingAccount}
                                    >
                                      {savingAccount ? 'Saving...' : editingProfile ? 'Save changes & reconnect' : 'Save & connect'}
                                    </Button>
                                  </ConnectionButtonRow>
                                </>
                              )}

                              {providerTestResult && (
                                <ConnectionTestResultBox
                                  $tone={providerTestResult.tone}
                                  role="status"
                                >
                                  <ConnectionResultTitle>
                                    {providerTestResult.title}
                                  </ConnectionResultTitle>
                                  <Meta>{providerTestResult.message}</Meta>
                                  {providerTestResult.nextSteps?.length ? (
                                    <ConnectionResultList>
                                      {providerTestResult.nextSteps.map(
                                        step => (
                                          <li key={step}>{step}</li>
                                        ),
                                      )}
                                    </ConnectionResultList>
                                  ) : null}
                                </ConnectionTestResultBox>
                              )}

                              <Meta>
                                Status:{' '}
                                {selectedMailProvider.id === 'gmail-oauth'
                                  ? googleStatusCopy
                                  : `${selectedMailProvider.badge}. Connects over the shell's mail socket transport; needs a PureDesktop build that ships it.`}{' '}
                                Passwords are stored OS-encrypted and read
                                only by the shell; server settings stay
                                readable here.
                              </Meta>
                            </ConnectionPanel>

                            <ConnectionPanel>
                              <ConnectionDetailHeader>
                                <ConnectionDetailMeta>
                                  Known defaults
                                </ConnectionDetailMeta>
                                <ConnectionPanelTitle>
                                  {selectedMailProvider.defaultsTitle}
                                </ConnectionPanelTitle>
                                <ConnectionPanelText>
                                  {selectedMailProvider.defaults}
                                </ConnectionPanelText>
                              </ConnectionDetailHeader>
                              <ConnectionStepList
                                aria-label={`${selectedMailProvider.title} defaults`}
                              >
                                {selectedMailProvider.id === 'gmail-oauth'
                                  ? GOOGLE_MAIL_DEFAULTS.map(
                                      (step, index) => (
                                        <ConnectionStepItem
                                          key={step.title}
                                        >
                                          <ConnectionStepNumber>
                                            {index + 1}
                                          </ConnectionStepNumber>
                                          <div>
                                            <ConnectionResultTitle>
                                              {step.title}
                                            </ConnectionResultTitle>
                                            <Meta>{step.detail}</Meta>
                                          </div>
                                        </ConnectionStepItem>
                                      ),
                                    )
                                  : selectedMailProvider.steps.map(
                                      (step, index) => (
                                        <ConnectionStepItem
                                          key={step.title}
                                        >
                                          <ConnectionStepNumber>
                                            {index + 1}
                                          </ConnectionStepNumber>
                                          <div>
                                            <ConnectionResultTitle>
                                              {step.title}
                                            </ConnectionResultTitle>
                                            <Meta>{step.detail}</Meta>
                                          </div>
                                        </ConnectionStepItem>
                                      ),
                                    )}
                              </ConnectionStepList>
                            </ConnectionPanel>
                          </ConnectionSetupGrid>

                          {selectedMailProvider.id === 'gmail-oauth' && (
                            <ConnectionPanel>
                              <ConnectionDetailHeader>
                                <ConnectionDetailMeta>
                                  Saved connection
                                </ConnectionDetailMeta>
                                <ConnectionPanelTitle>
                                  Google Gmail
                                </ConnectionPanelTitle>
                              </ConnectionDetailHeader>
                              <ConnectionSavedCard>
                                <div>
                                  <ConnectionResultTitle>
                                    {googleConnectionEmail}
                                  </ConnectionResultTitle>
                                  <Meta>{googleStatusCopy}</Meta>
                                </div>
                              </ConnectionSavedCard>
                            </ConnectionPanel>
                          )}
                        </>
                      ) : (
                        <ConnectionSetupGrid>
                          <ConnectionOptionGrid>
                            {MAIL_PROVIDER_OPTIONS.map(provider => {
                              const connected =
                                provider.id === 'gmail-oauth' &&
                                googleStatus?.connected === true
                              return (
                                <ConnectionOptionCard
                                  key={provider.id}
                                  type="button"
                                  onClick={() =>
                                    selectMailProvider(provider.id)
                                  }
                                >
                                  <ConnectionOptionHeader>
                                    <ConnectionPanelTitle>
                                      {provider.title}
                                    </ConnectionPanelTitle>
                                    <ConnectionOptionBadge
                                      $status={provider.status}
                                    >
                                      {connected
                                        ? 'connected'
                                        : provider.badge}
                                    </ConnectionOptionBadge>
                                  </ConnectionOptionHeader>
                                  <ConnectionPanelText>
                                    {provider.description}
                                  </ConnectionPanelText>
                                  <ConnectionResultTitle>
                                    {provider.meta}
                                  </ConnectionResultTitle>
                                </ConnectionOptionCard>
                              )
                            })}
                          </ConnectionOptionGrid>

                          <ConnectionPanel>
                            <ConnectionPanelTitle>
                              Pick one connection
                            </ConnectionPanelTitle>
                            <ConnectionPanelText>
                              Each option has its own setup page with known
                              defaults, a test button, and plain
                              instructions when something is missing.
                            </ConnectionPanelText>
                            <ConnectionStepList aria-label="Mail provider setup guidance">
                              {[
                                {
                                  title: 'Choose the provider',
                                  detail:
                                    'Start with the service the mailbox already uses; Gmail sign-in is the live path today.',
                                },
                                {
                                  title: 'Test before saving',
                                  detail:
                                    'The test explains what still needs to happen instead of returning a raw technical error.',
                                },
                                {
                                  title: 'Keep secrets in the vault',
                                  detail:
                                    'Passwords, app passwords, and tokens are stored through the shell vault.',
                                },
                              ].map((step, index) => (
                                <ConnectionStepItem key={step.title}>
                                  <ConnectionStepNumber>
                                    {index + 1}
                                  </ConnectionStepNumber>
                                  <div>
                                    <ConnectionResultTitle>
                                      {step.title}
                                    </ConnectionResultTitle>
                                    <Meta>{step.detail}</Meta>
                                  </div>
                                </ConnectionStepItem>
                              ))}
                            </ConnectionStepList>
                          </ConnectionPanel>
                        </ConnectionSetupGrid>
                      )}
                    </ConnectionSetupPage>
                  </SettingsDrawerBody>
                </SettingsDrawer>
              </SettingsDrawerBackdrop>
            )}

            <SettingsCard id="settings-fetching">
              <SettingsCardHeader>
                <div>
                  <Subject>Mail fetching</Subject>
                  <Meta>
                    Limit the default mailbox window and decide how often
                    PureMail asks the active provider for new mail.
                  </Meta>
                </div>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={mailFetching}
                  onClick={() => void refreshMail('manual')}
                >
                  {mailFetching ? 'Fetching...' : 'Fetch now'}
                </Button>
              </SettingsCardHeader>
              <SettingsOptionGrid>
                <SettingToggle>
                  Show mail from
                  <SelectField
                    value={mailFetchWindow}
                    onChange={event => {
                      const value = event.currentTarget
                        .value as MailFetchWindow
                      setStore(current => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          fetchWindow: value,
                        },
                      }))
                    }}
                    aria-label="Default mail fetch window"
                  >
                    <option value="today">Today only</option>
                    <option value="3d">Last 3 days</option>
                    <option value="7d">Last 7 days</option>
                    <option value="14d">Last 14 days</option>
                    <option value="30d">Last 30 days</option>
                  </SelectField>
                </SettingToggle>
                <SettingToggle>
                  <input
                    type="checkbox"
                    checked={autoFetchEnabled}
                    onChange={event => {
                      const checked = event.currentTarget.checked
                      setStore(current => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          autoFetchEnabled: checked,
                        },
                      }))
                    }}
                    aria-label="Auto-fetch mail"
                  />
                  Auto-fetch mail
                </SettingToggle>
                <SettingsFullRow>
                  <SettingToggle>
                    Fetch every
                    <SelectField
                      value={String(mailFetchIntervalMinutes)}
                      disabled={!autoFetchEnabled}
                      onChange={event => {
                        const value = Number(
                          event.currentTarget.value,
                        ) as MailFetchIntervalMinutes
                        setStore(current => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            fetchIntervalMinutes: value,
                          },
                        }))
                      }}
                      aria-label="Mail auto-fetch interval"
                    >
                      <option value="5">5 minutes</option>
                      <option value="15">15 minutes</option>
                      <option value="30">30 minutes</option>
                      <option value="60">60 minutes</option>
                    </SelectField>
                  </SettingToggle>
                </SettingsFullRow>
              </SettingsOptionGrid>
              <Meta>
                Provider sync uses this same policy. Changing the window
                filters the current view immediately and limits the next
                provider fetch.
              </Meta>
              <SettingsCardHeader>
                <div>
                  <Subject>Important / Other inbox</Subject>
                  <Meta>
                    Split inbox mail into focused Important and
                    lower-attention Other views.
                  </Meta>
                </div>
              </SettingsCardHeader>
              <Meta>
                Classification uses deterministic local rules only.
              </Meta>
              <SettingsCardHeader>
                <div>
                  <Subject>Follow-ups</Subject>
                  <Meta>Defaults for the toolbar Follow up action.</Meta>
                </div>
              </SettingsCardHeader>
              <SettingsOptionGrid>
                <SettingToggle>
                  Default delay
                  <SelectField
                    value={String(followUpSettings.defaultDelayDays)}
                    onChange={event =>
                      updateFollowUpSettings({
                        defaultDelayDays: Number(
                          event.currentTarget.value,
                        ) as NonNullable<
                          MailStore['settings']['followUp']
                        >['defaultDelayDays'],
                      })
                    }
                    aria-label="Follow-up default delay"
                  >
                    <option value="1">Tomorrow</option>
                    <option value="2">2 days</option>
                    <option value="3">3 days</option>
                    <option value="7">1 week</option>
                  </SelectField>
                </SettingToggle>
                <SettingToggle>
                  Default behavior
                  <SelectField
                    value={followUpSettings.defaultMode}
                    onChange={event =>
                      updateFollowUpSettings({
                        defaultMode: event.currentTarget
                          .value as NonNullable<
                          MailStore['settings']['followUp']
                        >['defaultMode'],
                      })
                    }
                    aria-label="Follow-up default behavior"
                  >
                    <option value="snooze">Snooze thread</option>
                    <option value="task">Create task</option>
                    <option value="snooze_and_task">Snooze + task</option>
                  </SelectField>
                </SettingToggle>
                <SettingToggle>
                  Default task list
                  <SelectField
                    value={followUpSettings.defaultTaskListId}
                    onChange={event =>
                      updateFollowUpSettings({
                        defaultTaskListId: event.currentTarget.value,
                      })
                    }
                    aria-label="Follow-up default task list"
                  >
                    {store.taskLists.map(taskList => (
                      <option key={taskList.id} value={taskList.id}>
                        {taskList.name}
                      </option>
                    ))}
                  </SelectField>
                </SettingToggle>
              </SettingsOptionGrid>
              <SettingsCardHeader>
                <div>
                  <Subject>Remote images</Subject>
                  <Meta>
                    Emails can load images from the sender's servers, which
                    can reveal when and where you read them.
                  </Meta>
                </div>
              </SettingsCardHeader>
              <SettingsOptionGrid>
                <SettingToggle>
                  Loading
                  <SelectField
                    value={store.settings.remoteImages?.policy ?? 'ask'}
                    aria-label="Remote image loading"
                    onChange={event => {
                      const policy = event.currentTarget.value as
                        | 'ask'
                        | 'always'
                      setStore(current => ({
                        ...current,
                        settings: setRemoteImagePolicy(
                          current.settings,
                          policy,
                        ),
                      }))
                    }}
                  >
                    <option value="ask">Ask before loading</option>
                    <option value="always">Always load</option>
                  </SelectField>
                </SettingToggle>
                <SettingsFullRow>
                  <Subject>Trusted senders</Subject>
                  {trustedImageSenders.length === 0 ? (
                    <Meta>
                      No trusted senders yet — choose “Always from this
                      sender” on a blocked message.
                    </Meta>
                  ) : (
                    <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                      {trustedImageSenders.map(email => (
                        <div
                          key={email}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            minWidth: 0,
                          }}
                        >
                          <Meta style={{ flex: 1, minWidth: 0 }}>{email}</Meta>
                          <Button
                            size="sm"
                            variant="text"
                            aria-label={`Stop loading images from ${email}`}
                            onClick={() =>
                              setStore(current => ({
                                ...current,
                                settings: untrustSender(
                                  current.settings,
                                  email,
                                ),
                              }))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </SettingsFullRow>
              </SettingsOptionGrid>
            </SettingsCard>

            <SettingsCard id="settings-filters">
              <SettingsCardHeader>
                <div>
                  <Subject>Filters</Subject>
                  <Meta>
                    Named queries with actions, run once over each newly
                    synced thread. Create one from any message via More →
                    Filter like this.
                  </Meta>
                </div>
              </SettingsCardHeader>
              {suggestMailFilters(store, selectedAccount?.id).map(
                suggestion => (
                  <div
                    key={suggestion.senderEmail}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Subject>Suggested: {suggestion.suggestedName}</Subject>
                      <Meta>
                        You archived {suggestion.archivedCount} threads from{' '}
                        {suggestion.senderEmail} — file them automatically?
                      </Meta>
                    </div>
                    <Button
                      size="sm"
                      onClick={() =>
                        setStore(current => {
                          const ensured = ensureMailLabel(
                            current,
                            suggestion.suggestedName,
                          )
                          const withView = saveMailView(
                            ensured.store,
                            ensured.label.name,
                            `label:${quoteQueryValue(ensured.label.name)}`,
                          )
                          return addMailFilter(withView, {
                            name: suggestion.suggestedName,
                            query: suggestion.suggestedQuery,
                            actions: {
                              labelName: ensured.label.name,
                              skipInbox: true,
                            },
                          }).store
                        })
                      }
                    >
                      File into box
                    </Button>
                  </div>
                ),
              )}
              {(store.filters ?? []).length === 0 ? (
                <Meta>No filters yet.</Meta>
              ) : (
                <div
                  style={{ display: 'grid', gap: 8 }}
                  aria-label="Mail filters"
                >
                  {(store.filters ?? []).map(rule => (
                    <div
                      key={rule.id}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        aria-label={`Enable filter ${rule.name}`}
                        onChange={event =>
                          setStore(current =>
                            setMailFilterEnabled(
                              current,
                              rule.id,
                              event.currentTarget.checked,
                            ),
                          )
                        }
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <Subject>{rule.name}</Subject>
                        <Meta>
                          {rule.query}
                          {rule.actions.labelName
                            ? ` → ${
                                rule.actions.skipInbox ? 'box' : 'label'
                              } “${rule.actions.labelName}”`
                            : ''}
                          {rule.actions.markRead ? ' · mark read' : ''}
                          {' · '}
                          {rule.hitCount > 0
                            ? `${rule.hitCount} hit${
                                rule.hitCount === 1 ? '' : 's'
                              }`
                            : 'no matches yet'}
                        </Meta>
                      </div>
                      <Button
                        size="sm"
                        variant="text"
                        title="Apply this rule to every existing match, including threads it already processed — the recovery path when a server action failed and left matches in the inbox."
                        onClick={() =>
                          setStore(current => {
                            const run = runMailFilters(
                              current,
                              selectedAccount?.id,
                              {
                                includeAlreadyRun: true,
                                ruleIds: [rule.id],
                              },
                            )
                            if (run.mutations.length > 0) {
                              window.setTimeout(
                                () => fireFilterMutations?.(run.mutations),
                                0,
                              )
                            }
                            window.setTimeout(
                              () =>
                                setCommandNotice(
                                  `“${rule.name}” ran over ${run.totalHits} match${
                                    run.totalHits === 1 ? '' : 'es'
                                  }.`,
                                ),
                              0,
                            )
                            return run.store
                          })
                        }
                      >
                        Run now
                      </Button>
                      <Button
                        size="sm"
                        variant="text"
                        onClick={() =>
                          setStore(current =>
                            deleteMailFilter(current, rule.id),
                          )
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </SettingsCard>

            <SettingsCard id="settings-compose">
              <SettingsCardHeader>
                <div>
                  <Subject>Reply assistance</Subject>
                  <Meta>
                    Drafts are only generated when you request one from a
                    thread.
                  </Meta>
                </div>
              </SettingsCardHeader>
              <SettingsOptionGrid>
                <SettingToggle>
                  <input
                    type="checkbox"
                    checked={quotedHistoryOpenByDefault}
                    onChange={event => {
                      const checked = event.currentTarget.checked
                      setStore(current => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          quotedHistoryOpenByDefault: checked,
                        },
                      }))
                    }}
                    aria-label="Open quoted history by default"
                  />
                  Open quoted history by default
                </SettingToggle>
                <SettingsFullRow>
                  <ComposeLabel>Reply drafting instructions</ComposeLabel>
                  <Meta>
                    Your standing guidance for drafted replies. Leave empty to
                    use the built-in defaults. Saving checks the text for
                    instructions that could weaken PureMail's drafting
                    guardrails.
                  </Meta>
                  <ComposeTextArea
                    aria-label="Reply drafting instructions"
                    rows={5}
                    value={draftingInstructionsInput}
                    placeholder="e.g. Keep replies short and direct. Never commit to a meeting without checking with me."
                    onChange={event => {
                      setDraftingInstructionsInput(event.currentTarget.value)
                      setPendingInstructionSave(null)
                    }}
                  />
                  <SettingsActions>
                    <Button size="sm" onClick={saveDraftingInstructions}>
                      Save instructions
                    </Button>
                  </SettingsActions>
                  {pendingInstructionSave && (
                    <InstructionRiskPanel
                      role="alertdialog"
                      aria-label="Instruction risk review"
                    >
                      <Subject>
                        These instructions may weaken PureMail's guardrails
                      </Subject>
                      <InstructionRiskList>
                        {pendingInstructionSave.risks.map(risk => (
                          <li key={risk.summary}>
                            {risk.summary}
                            <Meta>{risk.technicalReference}</Meta>
                          </li>
                        ))}
                      </InstructionRiskList>
                      <SettingsActions>
                        <Button
                          size="sm"
                          onClick={() =>
                            persistDraftingInstructions(
                              pendingInstructionSave.value,
                            )
                          }
                        >
                          Save anyway
                        </Button>
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => setPendingInstructionSave(null)}
                        >
                          Cancel
                        </Button>
                      </SettingsActions>
                    </InstructionRiskPanel>
                  )}
                </SettingsFullRow>
              </SettingsOptionGrid>
              <SettingsCardHeader>
                <div>
                  <Subject>Notifications</Subject>
                  <Meta>
                    Desktop notifications for new mail and snooze returns.
                    Nothing shows while notifications are muted or denied by
                    the system.
                  </Meta>
                </div>
              </SettingsCardHeader>
              <SettingsOptionGrid>
                <SettingToggle>
                  Notify about new mail
                  <input
                    type="checkbox"
                    checked={notificationPreferences.enabled}
                    onChange={event =>
                      patchNotificationPreferences({
                        enabled: event.currentTarget.checked,
                      })
                    }
                  />
                </SettingToggle>
                <SettingToggle>
                  Mute notifications
                  <SelectField
                    value={notificationsMutedNow ? 'muted' : 'off'}
                    aria-label="Mute notifications"
                    onChange={event => {
                      const value = event.currentTarget.value
                      if (
                        value === 'off' ||
                        value === 'hour' ||
                        value === 'tomorrow'
                      ) {
                        muteNotifications(value)
                      }
                    }}
                  >
                    {notificationsMutedNow &&
                      notificationPreferences.mutedUntil && (
                        <option value="muted">
                          Muted until{' '}
                          {formatDate(notificationPreferences.mutedUntil)}
                        </option>
                      )}
                    <option value="off">Off</option>
                    <option value="hour">For 1 hour</option>
                    <option value="tomorrow">Until tomorrow</option>
                  </SelectField>
                </SettingToggle>
                <SettingToggle>
                  Which threads
                  <SelectField
                    value={notificationPreferences.scope}
                    aria-label="Notification scope"
                    onChange={event =>
                      patchNotificationPreferences({
                        scope: event.currentTarget
                          .value as typeof notificationPreferences.scope,
                      })
                    }
                  >
                    <option value="important">Important only</option>
                    <option value="all">All inbox mail</option>
                    <option value="none">None</option>
                  </SelectField>
                </SettingToggle>
                {selectedAccount && (
                  <SettingToggle>
                    Override for {selectedAccount.email}
                    <SelectField
                      value={
                        notificationPreferences.perAccount?.[
                          selectedAccount.id
                        ] ?? ''
                      }
                      aria-label={`Notification override for ${selectedAccount.email}`}
                      onChange={event => {
                        const value = event.currentTarget.value
                        const perAccount = {
                          ...(notificationPreferences.perAccount ?? {}),
                        }
                        if (
                          value === 'all' ||
                          value === 'important' ||
                          value === 'none'
                        ) {
                          perAccount[selectedAccount.id] = value
                        } else {
                          delete perAccount[selectedAccount.id]
                        }
                        patchNotificationPreferences({ perAccount })
                      }}
                    >
                      <option value="">Use the global setting</option>
                      <option value="important">Important only</option>
                      <option value="all">All inbox mail</option>
                      <option value="none">None</option>
                    </SelectField>
                  </SettingToggle>
                )}
                <SettingToggle>
                  Notify when a snooze returns
                  <input
                    type="checkbox"
                    checked={notificationPreferences.notifyOnSnoozeReturn ?? true}
                    onChange={event =>
                      patchNotificationPreferences({
                        notifyOnSnoozeReturn: event.currentTarget.checked,
                      })
                    }
                  />
                </SettingToggle>
                <SettingToggle>
                  Undo send window
                  <SelectField
                    value={String(store.settings.undoSendDelaySeconds ?? 10)}
                    aria-label="Undo send window"
                    onChange={event => {
                      const seconds = Number(event.currentTarget.value) as
                        | 0
                        | 5
                        | 10
                        | 20
                        | 30
                      setStore(current => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          undoSendDelaySeconds: seconds,
                        },
                      }))
                    }}
                  >
                    <option value="0">Off — send immediately</option>
                    <option value="5">5 seconds</option>
                    <option value="10">10 seconds</option>
                    <option value="20">20 seconds</option>
                    <option value="30">30 seconds</option>
                  </SelectField>
                </SettingToggle>
              </SettingsOptionGrid>
            </SettingsCard>

            <SettingsCard id="settings-offline-queue">
              <SettingsCardHeader>
                <div>
                  <Subject>Offline changes</Subject>
                  <Meta>
                    Actions that could not reach the provider wait here and
                    retry on the next successful fetch.
                  </Meta>
                </div>
                <Button
                  size="sm"
                  disabled={queuedActions.length === 0}
                  onClick={() => void replayQueuedActionsNow()}
                >
                  Retry now
                </Button>
              </SettingsCardHeader>
              {queuedActions.length === 0 && (
                <Meta>Nothing queued — all changes are synced.</Meta>
              )}
              {queuedActions.map(action => (
                <SettingsFullRow key={action.id}>
                  <Meta>
                    {action.type} · thread {action.threadId} · queued{' '}
                    {action.queuedAt.slice(0, 16).replace('T', ' ')}
                    {action.lastError ? ` · ${action.lastError}` : ''}
                    {action.attempts > 0
                      ? ` · ${action.attempts} attempt${
                          action.attempts === 1 ? '' : 's'
                        }`
                      : ''}
                  </Meta>
                  <Button
                    size="sm"
                    onClick={() => discardQueuedActionNow(action.id)}
                  >
                    Discard
                  </Button>
                </SettingsFullRow>
              ))}
            </SettingsCard>

            <SettingsCard id="settings-signatures">
              <SettingsCardHeader>
                <div>
                  <Subject>Signatures</Subject>
                  <Meta>
                    Named signatures for this account. The default is added
                    to new messages; pick others from the composer.
                  </Meta>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    const signature: MailSignature = {
                      id: `signature_${Date.now()}`,
                      accountId: selectedAccount?.id,
                      name: `Signature ${accountSignatures.length + 1}`,
                      body: '',
                    }
                    setStore(current => ({
                      ...current,
                      settings: upsertSignature(current.settings, signature),
                    }))
                  }}
                >
                  Add signature
                </Button>
              </SettingsCardHeader>
              {accountSignatures.length === 0 && (
                <Meta>
                  No signatures yet. Add one, or keep using the voice
                  profile sign-off as the default.
                </Meta>
              )}
              {accountSignatures.map(signature => (
                <SignatureListRow key={signature.id}>
                  <TaskField>
                    <ComposeLabel>Name</ComposeLabel>
                    <ComposeInput
                      value={signature.name}
                      aria-label={`Signature name for ${signature.name}`}
                      onChange={event => {
                        const name = event.currentTarget.value
                        setStore(current => ({
                          ...current,
                          settings: upsertSignature(current.settings, {
                            ...signature,
                            name,
                          }),
                        }))
                      }}
                    />
                  </TaskField>
                  <TaskField>
                    <ComposeLabel>Signature text</ComposeLabel>
                    <ComposeTextArea
                      style={{ minHeight: 64, resize: 'vertical' }}
                      value={signature.body}
                      aria-label={`Signature text for ${signature.name}`}
                      placeholder={'Best,\nAdam'}
                      onChange={event => {
                        const body = event.currentTarget.value
                        setStore(current => ({
                          ...current,
                          settings: upsertSignature(current.settings, {
                            ...signature,
                            body,
                          }),
                        }))
                      }}
                    />
                  </TaskField>
                  <SettingsActions>
                    <Button
                      size="sm"
                      disabled={Boolean(signature.isDefault)}
                      onClick={() =>
                        setStore(current => ({
                          ...current,
                          settings: upsertSignature(current.settings, {
                            ...signature,
                            isDefault: true,
                          }),
                        }))
                      }
                    >
                      {signature.isDefault ? 'Default' : 'Make default'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        setStore(current => ({
                          ...current,
                          settings: removeSignature(
                            current.settings,
                            signature.id,
                          ),
                        }))
                      }
                    >
                      Delete
                    </Button>
                  </SettingsActions>
                </SignatureListRow>
              ))}
            </SettingsCard>

            <SettingsCard id="settings-shortcuts">
              <SettingsCardHeader>
                <div>
                  <Subject>Keyboard shortcuts</Subject>
                  <Meta>
                    Gmail-style single-key commands. They stay quiet while
                    you are typing in any field or editor.
                  </Meta>
                </div>
              </SettingsCardHeader>
              <ShortcutList>
                {mailCommands.map(command => (
                  <Fragment key={command.id}>
                    <ShortcutKey>{command.shortcut}</ShortcutKey>
                    <ShortcutMeaning>
                      {command.label} — {command.description}
                    </ShortcutMeaning>
                  </Fragment>
                ))}
              </ShortcutList>
            </SettingsCard>
    </AppSettingsPages>
  )
}
