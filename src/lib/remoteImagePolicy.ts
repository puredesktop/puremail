import { MailSettings, RemoteImageSettings } from '../types'

/**
 * Remote-image loading policy — the pure rules behind the reader banner and
 * the settings drawer.
 *
 * Privacy default: images stay blocked until the user chooses. Three
 * escalating choices exist — load once for one message (session-only state
 * in the shell), always for one sender (persisted trusted list), always for
 * everyone (persisted policy). The decision function ranks them in that
 * order of breadth, widest first, so the banner can explain WHY images are
 * loading and offer the matching reverse action.
 *
 * Settings updates here always return NEW objects with EXPLICIT values —
 * the shell config sync is a spread-merge that cannot delete keys, so "off"
 * is `policy: 'ask'`, never a removed key.
 */

export type RemoteImageReason =
  | 'policy-always'
  | 'trusted-sender'
  | 'once'
  | 'blocked'

export interface RemoteImageDecision {
  load: boolean
  reason: RemoteImageReason
}

/** Sender identity for the trusted list: trimmed, lowercased address. */
export function normalizeSenderEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

function normalizedTrustedSenders(
  remoteImages: RemoteImageSettings | undefined,
): string[] {
  const seen = new Set<string>()
  for (const entry of remoteImages?.trustedSenders ?? []) {
    const normalized = normalizeSenderEmail(entry)
    if (normalized) seen.add(normalized)
  }
  return [...seen]
}

/**
 * Should this message's remote images load, and why? Precedence is widest
 * grant first: global policy, then trusted sender, then the session-only
 * per-message "once" list, then blocked (the default).
 */
export function remoteImageDecision({
  settings,
  senderEmail,
  messageId,
  onceLoadedIds,
}: {
  settings: Pick<MailSettings, 'remoteImages'> | undefined
  senderEmail: string | undefined
  messageId: string
  onceLoadedIds: readonly string[]
}): RemoteImageDecision {
  const remoteImages = settings?.remoteImages
  if ((remoteImages?.policy ?? 'ask') === 'always') {
    return { load: true, reason: 'policy-always' }
  }
  const sender = normalizeSenderEmail(senderEmail)
  if (sender && normalizedTrustedSenders(remoteImages).includes(sender)) {
    return { load: true, reason: 'trusted-sender' }
  }
  if (onceLoadedIds.includes(messageId)) {
    return { load: true, reason: 'once' }
  }
  return { load: false, reason: 'blocked' }
}

/** Add a sender to the trusted list (normalized, deduped). */
export function trustSender(
  settings: MailSettings,
  email: string,
): MailSettings {
  const normalized = normalizeSenderEmail(email)
  if (!normalized) return settings
  const trustedSenders = normalizedTrustedSenders(settings.remoteImages)
  if (!trustedSenders.includes(normalized)) trustedSenders.push(normalized)
  return {
    ...settings,
    remoteImages: {
      policy: settings.remoteImages?.policy ?? 'ask',
      trustedSenders,
    },
  }
}

/** Remove a sender from the trusted list (matched after normalization). */
export function untrustSender(
  settings: MailSettings,
  email: string,
): MailSettings {
  const normalized = normalizeSenderEmail(email)
  return {
    ...settings,
    remoteImages: {
      policy: settings.remoteImages?.policy ?? 'ask',
      trustedSenders: normalizedTrustedSenders(settings.remoteImages).filter(
        sender => sender !== normalized,
      ),
    },
  }
}

/** Set the global policy, keeping the trusted list intact. */
export function setRemoteImagePolicy(
  settings: MailSettings,
  policy: 'ask' | 'always',
): MailSettings {
  return {
    ...settings,
    remoteImages: {
      policy,
      trustedSenders: normalizedTrustedSenders(settings.remoteImages),
    },
  }
}

export interface RemoteImageBannerState {
  /** The banner's status line. */
  label: string
  /**
   * The single reverse action for a loaded state, or null when blocked —
   * the blocked banner offers the three-way selector instead.
   */
  actionLabel: string | null
}

/**
 * What the reader banner says for a decision, and which single reverse
 * action (if any) it offers. Loaded states name their cause so the reverse
 * action's scope is unambiguous.
 */
export function remoteImageBannerState(
  decision: RemoteImageDecision,
  senderEmail: string | undefined,
): RemoteImageBannerState {
  switch (decision.reason) {
    case 'policy-always':
      return {
        label: 'Images load automatically (all senders)',
        actionLabel: 'Turn off',
      }
    case 'trusted-sender':
      return {
        label: `Images load automatically for ${normalizeSenderEmail(senderEmail)}`,
        actionLabel: 'Block for this sender',
      }
    case 'once':
      return { label: 'Remote images loaded', actionLabel: 'Block images' }
    case 'blocked':
      return {
        label: 'Remote images blocked for privacy',
        actionLabel: null,
      }
  }
}
