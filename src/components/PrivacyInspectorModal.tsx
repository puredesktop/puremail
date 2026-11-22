import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  EyeOff,
  FileCode2,
  Link2,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import styled, { css } from 'styled-components'
import {
  formatDecisionModelLabel,
  type MailSecurityDecision,
  type SecurityRiskFlag,
} from '../lib/mailDecisionOps'
import type { LinkWarning, TrackerHit } from '../lib/mailPrivacyShield'
import type { MailAuthResults, MailAuthVerdict, MailMessage } from '../types'

export interface PrivacyInspectorModalProps {
  open: boolean
  onClose: () => void
  message: MailMessage
  trackers: TrackerHit[]
  linkWarnings: LinkWarning[]
  senderMismatch: { fromDomain: string; replyOrReturnDomain: string } | null
  auth: MailAuthResults
  modelSecurity?: MailSecurityDecision | null
  rawSource?: string
}

function securityFlagLabel(flag: SecurityRiskFlag): string {
  switch (flag) {
    case 'credentials':
      return 'Credential request'
    case 'impersonation_phishing':
      return 'Phishing / impersonation'
    case 'domain_conflict':
      return 'Identity vs domain mismatch'
    case 'urgency_pressure':
      return 'Urgency pressure tactic'
  }
}

type InspectorTab = 'security' | 'headers'

function verdictLabel(verdict: MailAuthVerdict): string {
  switch (verdict) {
    case 'pass':
      return 'Pass'
    case 'fail':
      return 'Fail'
    case 'neutral':
      return 'Neutral'
    default:
      return 'None'
  }
}

function linkReasonLabel(reason: LinkWarning['reason']): string {
  switch (reason) {
    case 'domain-mismatch':
      return 'Domain mismatch'
    case 'punycode':
      return 'Punycode / IDN'
    case 'ip-literal':
      return 'Raw IP address'
    case 'suspicious-scheme':
      return 'Unsafe scheme'
  }
}

function synthesizeHeaders(
  message: MailMessage,
  auth: MailAuthResults,
): Array<{ name: string; value: string }> {
  if (message.rawHeaders && message.rawHeaders.length > 0) {
    return message.rawHeaders
  }
  const rows: Array<{ name: string; value: string }> = []
  const formatContact = (c: { name: string; email: string }): string =>
    c.name ? `${c.name} <${c.email}>` : c.email
  rows.push({ name: 'From', value: formatContact(message.from) })
  if (message.to.length > 0) {
    rows.push({ name: 'To', value: message.to.map(formatContact).join(', ') })
  }
  if (message.cc && message.cc.length > 0) {
    rows.push({ name: 'Cc', value: message.cc.map(formatContact).join(', ') })
  }
  if (message.replyTo && message.replyTo.length > 0) {
    rows.push({
      name: 'Reply-To',
      value: message.replyTo.map(formatContact).join(', '),
    })
  }
  if (message.returnPath) {
    rows.push({ name: 'Return-Path', value: message.returnPath })
  }
  rows.push({ name: 'Subject', value: message.subject })
  rows.push({ name: 'Date', value: message.receivedAt })
  if (message.messageIdHeader) {
    rows.push({ name: 'Message-ID', value: message.messageIdHeader })
  }
  if (message.inReplyTo) {
    rows.push({ name: 'In-Reply-To', value: message.inReplyTo })
  }
  if (auth.raw) {
    rows.push({ name: 'Authentication-Results', value: auth.raw })
  }
  if (message.listUnsubscribe) {
    rows.push({ name: 'List-Unsubscribe', value: message.listUnsubscribe })
  }
  if (message.importance) {
    rows.push({ name: 'Importance', value: message.importance })
  }
  return rows
}

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--platform-z-index-zi-app-modal, 300);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(0 0 0 / 0.44);
  font-family: var(--platform-typography-font-family, sans-serif);
`

const Dialog = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 680px;
  max-height: min(84vh, 640px);
  overflow: hidden;
  border: 1px solid var(--n-line);
  border-radius: 6px;
  background: var(--n-sheet);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.22);
  color: var(--n-ink);
`

const Header = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--n-fence);
  background: var(--n-panel);
`

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
`

const Title = styled.h2`
  margin: 0;
  font-size: 14px;
  font-weight: 700;
`

const SubText = styled.div`
  overflow: hidden;
  color: var(--n-faint);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const CloseBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--n-btn-line);
  border-radius: 3px;
  background: var(--n-sheet);
  color: var(--n-soft);
  cursor: pointer;

  &:hover {
    background: var(--n-hover);
    color: var(--n-ink);
  }
`

const TabBar = styled.div`
  display: flex;
  flex: none;
  gap: 4px;
  padding: 0 16px;
  border-bottom: 1px solid var(--n-line);
  background: var(--n-panel);
`

const TabButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-bottom: 2px solid
    ${props =>
      props.$active
        ? 'var(--pure-chrome-accent, var(--p-text))'
        : 'transparent'};
  background: transparent;
  color: ${props => (props.$active ? 'var(--n-ink)' : 'var(--n-soft)')};
  font-family: inherit;
  font-size: 12.5px;
  font-weight: ${props => (props.$active ? 700 : 500)};
  cursor: pointer;

  &:hover {
    color: var(--n-ink);
  }
`

const Body = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SectionTitle = styled.h3`
  margin: 0 0 8px;
  color: var(--n-soft);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`

const AuthGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
`

const AuthCard = styled.div<{ $verdict: MailAuthVerdict }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 4px;

  ${props => {
    if (props.$verdict === 'pass') {
      return css`
        border: 1px solid var(--p-done-border, var(--p-done-line));
        background: var(--p-done-bg, var(--p-done-tint));
        color: var(--p-done-fg, var(--p-done-text));
      `
    }
    if (props.$verdict === 'fail') {
      return css`
        border: 1px solid var(--p-failed-border, var(--p-failed-line));
        background: var(--p-failed-bg, var(--p-failed-tint));
        color: var(--p-failed-fg, var(--p-failed-text));
      `
    }
    if (props.$verdict === 'neutral') {
      return css`
        border: 1px solid var(--p-needs-you-border, var(--p-needs-you-line));
        background: var(--p-needs-you-bg, var(--p-needs-you-tint));
        color: var(--p-needs-you-fg, var(--p-needs-you-text));
      `
    }
    return css`
      border: 1px solid var(--n-line);
      background: var(--n-panel);
      color: var(--n-soft);
    `
  }}
`

const AuthName = styled.span`
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  opacity: 0.85;
`

const AuthVerdictText = styled.span`
  font-size: 14px;
  font-weight: 700;
`

const InfoCard = styled.div<{ $tone?: 'ok' | 'warn' | 'danger' | 'neutral' }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 4px;
  font-size: 12.5px;

  ${props => {
    if (props.$tone === 'ok') {
      return css`
        border: 1px solid var(--p-done-border, var(--p-done-line));
        background: var(--p-done-bg, var(--p-done-tint));
        color: var(--p-done-fg, var(--p-done-text));
      `
    }
    if (props.$tone === 'warn') {
      return css`
        border: 1px solid var(--p-needs-you-border, var(--p-needs-you-line));
        background: var(--p-needs-you-bg, var(--p-needs-you-tint));
        color: var(--p-needs-you-fg, var(--p-needs-you-text));
      `
    }
    if (props.$tone === 'danger') {
      return css`
        border: 1px solid var(--p-failed-border, var(--p-failed-line));
        background: var(--p-failed-bg, var(--p-failed-tint));
        color: var(--p-failed-fg, var(--p-failed-text));
      `
    }
    return css`
      border: 1px solid var(--n-fence);
      background: var(--n-panel);
      color: var(--n-soft);
    `
  }}
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--n-line);
  border-radius: 4px;
  overflow: hidden;
`

const ListItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 12px;
  background: var(--n-sheet);
  &:not(:first-child) {
    border-top: 1px solid var(--n-fence);
  }
`

const ListItemTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const Badge = styled.span<{ $tone: 'done' | 'warn' | 'danger' | 'neutral' }>`
  display: inline-flex;
  align-items: center;
  height: 19px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 10.5px;
  font-weight: 700;

  ${props => {
    if (props.$tone === 'done') {
      return css`
        border: 1px solid var(--p-done-border, var(--p-done-line));
        background: var(--p-done-bg, var(--p-done-tint));
        color: var(--p-done-fg, var(--p-done-text));
      `
    }
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
    return css`
      border: 1px solid var(--n-line);
      background: var(--n-panel);
      color: var(--n-soft);
    `
  }}
`

const MonoText = styled.code`
  overflow-wrap: anywhere;
  color: var(--n-soft);
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 11px;
  line-height: 1.45;
`

const HeadersToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const FilterWrap = styled.div`
  display: flex;
  flex: 1;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--n-line);
  border-radius: 3px;
  background: var(--n-sheet);
`

const FilterInput = styled.input`
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12px;
  outline: none;
`

const CopyBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--n-btn-line);
  border-radius: 3px;
  background: var(--n-sheet);
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--n-hover);
  }
`

const HeadersTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  border: 1px solid var(--n-line);
  border-radius: 4px;
  font-size: 11.5px;

  th,
  td {
    padding: 7px 10px;
    border-bottom: 1px solid var(--n-fence);
    vertical-align: top;
    text-align: left;
  }

  tr:last-child th,
  tr:last-child td {
    border-bottom: 0;
  }

  th {
    width: 168px;
    background: var(--n-panel);
    color: var(--n-soft);
    font-family: var(--platform-typography-font-family-mono, monospace);
    font-weight: 600;
    word-break: break-word;
  }

  td {
    background: var(--n-sheet);
    color: var(--n-ink);
    font-family: var(--platform-typography-font-family-mono, monospace);
    overflow-wrap: anywhere;
  }
`

const RawSourcePre = styled.pre`
  margin: 0;
  padding: 10px 12px;
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--n-line);
  border-radius: 4px;
  background: var(--n-panel);
  color: var(--n-soft);
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`

export function PrivacyInspectorModal({
  open,
  onClose,
  message,
  trackers,
  linkWarnings,
  senderMismatch,
  auth,
  modelSecurity,
  rawSource,
}: PrivacyInspectorModalProps): React.ReactElement | null {
  const [tab, setTab] = useState<InspectorTab>('security')
  const [headerQuery, setHeaderQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setTab('security')
    setHeaderQuery('')
    setCopied(false)
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = null
    }
    requestAnimationFrame(() => {
      closeBtnRef.current?.focus()
    })
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, message.id, onClose])

  const allHeaders = useMemo(
    () => synthesizeHeaders(message, auth),
    [message, auth],
  )

  const filteredHeaders = useMemo(() => {
    const q = headerQuery.trim().toLowerCase()
    if (!q) return allHeaders
    return allHeaders.filter(
      h =>
        h.name.toLowerCase().includes(q) || h.value.toLowerCase().includes(q),
    )
  }, [allHeaders, headerQuery])

  if (!open) return null

  const rawHeadersText = allHeaders
    .map(header => `${header.name}: ${header.value}`)
    .join('\n')

  const handleCopyHeaders = async (): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) return
      await navigator.clipboard.writeText(rawHeadersText)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => {
        setCopied(false)
        copyTimerRef.current = null
      }, 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Backdrop
      data-testid="privacy-inspector-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-label="Privacy and security inspector"
        onMouseDown={event => event.stopPropagation()}
      >
        <Header>
          <HeaderLeft>
            <ShieldCheck
              size={16}
              style={{ color: 'var(--pure-chrome-accent, var(--p-text))', flex: 'none' }}
              aria-hidden="true"
            />
            <div style={{ minWidth: 0 }}>
              <Title>Privacy &amp; Security Inspector</Title>
              <SubText>
                {message.from.name || message.from.email} · {message.subject}
              </SubText>
            </div>
          </HeaderLeft>
          <CloseBtn
            ref={closeBtnRef}
            type="button"
            aria-label="Close privacy inspector"
            onClick={onClose}
          >
            <X size={14} />
          </CloseBtn>
        </Header>

        <TabBar role="tablist" aria-label="Inspector sections">
          <TabButton
            type="button"
            role="tab"
            aria-selected={tab === 'security'}
            $active={tab === 'security'}
            onClick={() => setTab('security')}
          >
            <ShieldCheck size={13} aria-hidden="true" />
            Privacy &amp; Security
          </TabButton>
          <TabButton
            type="button"
            role="tab"
            aria-selected={tab === 'headers'}
            $active={tab === 'headers'}
            onClick={() => setTab('headers')}
          >
            <FileCode2 size={13} aria-hidden="true" />
            Original Headers ({allHeaders.length})
          </TabButton>
        </TabBar>

        <Body>
          {tab === 'security' ? (
            <>
              <div>
                <SectionTitle>Authentication</SectionTitle>
                <AuthGrid>
                  <AuthCard $verdict={auth.spf}>
                    <AuthName>SPF</AuthName>
                    <AuthVerdictText>{verdictLabel(auth.spf)}</AuthVerdictText>
                  </AuthCard>
                  <AuthCard $verdict={auth.dkim}>
                    <AuthName>DKIM</AuthName>
                    <AuthVerdictText>{verdictLabel(auth.dkim)}</AuthVerdictText>
                  </AuthCard>
                  <AuthCard $verdict={auth.dmarc}>
                    <AuthName>DMARC</AuthName>
                    <AuthVerdictText>
                      {verdictLabel(auth.dmarc)}
                    </AuthVerdictText>
                  </AuthCard>
                </AuthGrid>
                {auth.raw && (
                  <div style={{ marginTop: 8 }}>
                    <MonoText>{auth.raw}</MonoText>
                  </div>
                )}
              </div>

              <div>
                <SectionTitle>Sender Alignment</SectionTitle>
                {senderMismatch ? (
                  <InfoCard $tone="warn">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontWeight: 700,
                      }}
                    >
                      <AlertTriangle size={14} aria-hidden="true" />
                      <span>From and Reply-To / Return-Path domains differ</span>
                    </div>
                    <MonoText>
                      From: {senderMismatch.fromDomain} → Reply/Return:{' '}
                      {senderMismatch.replyOrReturnDomain}
                    </MonoText>
                  </InfoCard>
                ) : (
                  <InfoCard $tone="ok">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontWeight: 600,
                      }}
                    >
                      <CheckCircle2 size={14} aria-hidden="true" />
                      <span>
                        Sender domain aligns with Reply-To and envelope headers.
                      </span>
                    </div>
                  </InfoCard>
                )}
              </div>

              {modelSecurity && (
                <div>
                  <SectionTitle>
                    Decision Model Risk Analysis (
                    {formatDecisionModelLabel(
                      modelSecurity.provider,
                      modelSecurity.model,
                    )}
                    )
                  </SectionTitle>
                  <InfoCard
                    $tone={
                      modelSecurity.riskLevel === 'danger'
                        ? 'danger'
                        : modelSecurity.riskLevel === 'warn'
                          ? 'warn'
                          : 'ok'
                    }
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontWeight: 600,
                      }}
                    >
                      {modelSecurity.riskLevel === 'clear' ? (
                        <CheckCircle2 size={14} aria-hidden="true" />
                      ) : (
                        <AlertTriangle size={14} aria-hidden="true" />
                      )}
                      <span>{modelSecurity.summary}</span>
                    </div>
                    {modelSecurity.flags.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 6,
                          marginTop: 4,
                        }}
                      >
                        {modelSecurity.flags.map(flag => (
                          <Badge
                            key={flag}
                            $tone={
                              flag === 'credentials' ||
                              flag === 'impersonation_phishing'
                                ? 'danger'
                                : 'warn'
                            }
                          >
                            {securityFlagLabel(flag)} ·{' '}
                            {Math.round(modelSecurity.scores[flag] * 100)}%
                          </Badge>
                        ))}
                      </div>
                    )}
                  </InfoCard>
                </div>
              )}

              <div>
                <SectionTitle>
                  Trackers Blocked ({trackers.length})
                </SectionTitle>
                {trackers.length === 0 ? (
                  <InfoCard $tone="neutral">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <EyeOff size={14} aria-hidden="true" />
                      <span>No open-tracking pixels detected in this message.</span>
                    </div>
                  </InfoCard>
                ) : (
                  <List>
                    {trackers.map((hit, idx) => (
                      <ListItem key={`${hit.vendor}-${idx}`}>
                        <ListItemTop>
                          <strong style={{ fontSize: 12.5 }}>{hit.vendor}</strong>
                          <Badge $tone="done">
                            {hit.reason === 'known-tracker'
                              ? 'Known tracker'
                              : '1×1 pixel beacon'}
                          </Badge>
                        </ListItemTop>
                        <MonoText>{hit.url}</MonoText>
                      </ListItem>
                    ))}
                  </List>
                )}
              </div>

              <div>
                <SectionTitle>
                  Link &amp; Phishing Checks ({linkWarnings.length})
                </SectionTitle>
                {linkWarnings.length === 0 ? (
                  <InfoCard $tone="ok">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontWeight: 600,
                      }}
                    >
                      <Link2 size={14} aria-hidden="true" />
                      <span>No deceptive or suspicious links detected.</span>
                    </div>
                  </InfoCard>
                ) : (
                  <List>
                    {linkWarnings.map((warning, idx) => (
                      <ListItem key={`${warning.href}-${idx}`}>
                        <ListItemTop>
                          <strong style={{ fontSize: 12.5 }}>
                            {warning.displayText || 'Link'}
                          </strong>
                          <Badge $tone="danger">
                            {linkReasonLabel(warning.reason)}
                          </Badge>
                        </ListItemTop>
                        <MonoText>{warning.href}</MonoText>
                      </ListItem>
                    ))}
                  </List>
                )}
              </div>
            </>
          ) : (
            <>
              <HeadersToolbar>
                <FilterWrap>
                  <Search
                    size={13}
                    style={{ color: 'var(--n-faint)', flex: 'none' }}
                    aria-hidden="true"
                  />
                  <FilterInput
                    type="text"
                    value={headerQuery}
                    onChange={event => setHeaderQuery(event.target.value)}
                    placeholder="Filter headers by name or value…"
                    aria-label="Filter RFC headers"
                  />
                </FilterWrap>
                <CopyBtn type="button" onClick={handleCopyHeaders}>
                  {copied ? (
                    <>
                      <Check size={13} aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy size={13} aria-hidden="true" />
                      Copy raw headers
                    </>
                  )}
                </CopyBtn>
              </HeadersToolbar>

              <HeadersTable>
                <tbody>
                  {filteredHeaders.length === 0 ? (
                    <tr>
                      <td colSpan={2} style={{ color: 'var(--n-faint)' }}>
                        No headers match &ldquo;{headerQuery}&rdquo;.
                      </td>
                    </tr>
                  ) : (
                    filteredHeaders.map((header, idx) => (
                      <tr key={`${header.name}-${idx}`}>
                        <th>{header.name}</th>
                        <td>{header.value}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </HeadersTable>

              {rawSource && (
                <div>
                  <SectionTitle>Raw Source</SectionTitle>
                  <RawSourcePre>{rawSource}</RawSourcePre>
                </div>
              )}
            </>
          )}
        </Body>
      </Dialog>
    </Backdrop>
  )
}
