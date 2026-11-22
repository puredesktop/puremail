import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import styled, { css } from 'styled-components'
import type { MailSecurityDecision } from '../lib/mailDecisionOps'
import type { LinkWarning, TrackerHit } from '../lib/mailPrivacyShield'
import type { MailAuthResults } from '../types'

export interface SecurityShieldPillProps {
  trackers: TrackerHit[]
  linkWarnings: LinkWarning[]
  senderMismatch: { fromDomain: string; replyOrReturnDomain: string } | null
  auth: MailAuthResults
  modelSecurity?: MailSecurityDecision | null
  onClick: () => void
}

type ShieldTone = 'danger' | 'warn' | 'safe' | 'neutral'

const PillButton = styled.button<{ $tone: ShieldTone }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 3px;
  font-family: var(--platform-typography-font-family, sans-serif);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: filter 0.1s ease, background 0.1s ease;

  ${props => {
    if (props.$tone === 'danger') {
      return css`
        border: 1px solid var(--p-failed-border, var(--p-failed-line));
        background: var(--p-failed-bg, var(--p-failed-tint));
        color: var(--p-failed-fg, var(--p-failed-text));
      `
    }
    if (props.$tone === 'warn') {
      return css`
        border: 1px solid var(--p-needs-you-border, var(--p-needs-you-line));
        background: var(--p-needs-you-bg, var(--p-needs-you-tint));
        color: var(--p-needs-you-fg, var(--p-needs-you-text));
      `
    }
    if (props.$tone === 'safe') {
      return css`
        border: 1px solid var(--p-done-border, var(--p-done-line));
        background: var(--p-done-bg, var(--p-done-tint));
        color: var(--p-done-fg, var(--p-done-text));
      `
    }
    return css`
      border: 1px solid var(--n-line);
      background: var(--n-panel);
      color: var(--n-soft);
    `
  }}

  &:hover {
    filter: brightness(0.96);
  }
  &:focus-visible {
    outline: 2px solid var(--pure-chrome-accent, var(--p-text));
    outline-offset: 2px;
  }
`

export function SecurityShieldPill({
  trackers,
  linkWarnings,
  senderMismatch,
  auth,
  modelSecurity,
  onClick,
}: SecurityShieldPillProps): React.ReactElement {
  const authFailed = auth.dmarc === 'fail' || auth.spf === 'fail'
  const modelDanger = modelSecurity?.riskLevel === 'danger'
  const modelWarn = modelSecurity?.riskLevel === 'warn'
  const hasWarning =
    linkWarnings.length > 0 ||
    Boolean(senderMismatch) ||
    authFailed ||
    modelDanger ||
    modelWarn
  const verified = auth.spf === 'pass' && auth.dkim === 'pass'

  let tone: ShieldTone = 'neutral'
  let label = 'Security'

  if (authFailed || linkWarnings.length > 0 || modelDanger) {
    tone = 'danger'
    if (linkWarnings.length > 0) {
      label = `${linkWarnings.length} suspicious ${
        linkWarnings.length === 1 ? 'link' : 'links'
      }`
    } else if (modelDanger) {
      label = modelSecurity?.flags.includes('credentials')
        ? 'Credential risk'
        : 'Phishing risk'
    } else {
      label = 'Auth failed'
    }
  } else if (senderMismatch || modelWarn) {
    tone = 'warn'
    label = senderMismatch
      ? 'Domain mismatch'
      : modelSecurity?.flags.includes('urgency_pressure')
        ? 'Urgency pressure'
        : 'Sender warning'
  } else if (trackers.length > 0) {
    tone = 'safe'
    label = `${trackers.length} ${
      trackers.length === 1 ? 'tracker' : 'trackers'
    } blocked`
  } else if (verified) {
    tone = 'safe'
    label = 'Verified'
  }

  const Icon = hasWarning ? ShieldAlert : tone === 'safe' ? ShieldCheck : Shield

  return (
    <PillButton
      type="button"
      $tone={tone}
      onClick={onClick}
      aria-label={`Privacy and security details: ${label}`}
      title="Inspect authentication, tracking pixels, links, and raw headers"
    >
      <Icon size={12} aria-hidden="true" />
      <span>{label}</span>
    </PillButton>
  )
}
