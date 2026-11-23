import { useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import styled, { css } from 'styled-components'
import type { MailSignal } from '@purescience/platform-ui/bridge/mailHub'
import { getSignalDisplayMeta, type SignalChipTone } from '../lib/mailHubSync'

export interface ThreadSignalChipsProps {
  signals: readonly MailSignal[]
  onAccept: (signalId: string) => void | Promise<unknown>
  onDismiss: (signalId: string) => void | Promise<unknown>
}

const Strip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-family: var(--platform-typography-font-family, sans-serif);
`

const SignalChip = styled.div<{ $tone: SignalChipTone }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-height: 24px;
  padding: 2px 6px 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.2;

  ${props => {
    if (props.$tone === 'warn') {
      return css`
        border: 1px solid var(--p-needs-you-border, var(--p-needs-you-line, var(--n-line)));
        background: var(--p-needs-you-bg, var(--p-needs-you-tint, var(--n-panel)));
        color: var(--p-needs-you-fg, var(--p-needs-you-text, var(--n-text)));
      `
    }
    if (props.$tone === 'success') {
      return css`
        border: 1px solid var(--p-done-border, var(--p-done-line, var(--n-line)));
        background: var(--p-done-bg, var(--p-done-tint, var(--n-panel)));
        color: var(--p-done-fg, var(--p-done-text, var(--n-text)));
      `
    }
    return css`
      border: 1px solid var(--n-line);
      background: var(--n-panel);
      color: var(--n-text);
    `
  }}
`

const SignalText = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const SignalLabel = styled.strong`
  font-weight: 600;
`

const TargetBadge = styled.span`
  color: var(--n-soft);
  font-weight: 500;
`

const SummarySnippet = styled.span`
  color: var(--n-soft);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ChipActions = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 2px;
`

const ActionButton = styled.button<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 19px;
  padding: 0 6px;
  border-radius: 3px;
  border: 1px solid var(--n-line);
  background: ${props =>
    props.$primary ? 'var(--n-bg, #ffffff)' : 'transparent'};
  color: var(--n-text);
  font-family: inherit;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    filter: brightness(0.94);
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid var(--pure-chrome-accent, var(--p-text));
    outline-offset: 1px;
  }
`

export function ThreadSignalChips({
  signals,
  onAccept,
  onDismiss,
}: ThreadSignalChipsProps): React.ReactElement | null {
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({})

  if (signals.length === 0) return null

  const run = async (id: string, fn: () => void | Promise<unknown>) => {
    if (busyIds[id]) return
    setBusyIds(prev => ({ ...prev, [id]: true }))
    try {
      await fn()
    } finally {
      setBusyIds(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  return (
    <Strip
      role="region"
      aria-label="Detected email signals"
      data-testid="thread-signal-chips"
    >
      {signals.map(signal => {
        const meta = getSignalDisplayMeta(signal)
        const busy = Boolean(busyIds[signal.id])
        const tooltip = `${meta.label} → ${meta.targetAppLabel}: ${signal.summary} (${Math.round(
          signal.confidence * 100,
        )}% confidence)`
        return (
          <SignalChip
            key={signal.id}
            $tone={meta.tone}
            title={tooltip}
            data-testid={`thread-signal-chip-${signal.id}`}
          >
            <SignalText>
              <Sparkles size={11} aria-hidden="true" />
              <SignalLabel>{meta.label}</SignalLabel>
              <TargetBadge>→ {meta.targetAppLabel}</TargetBadge>
              {signal.summary && (
                <SummarySnippet>· {signal.summary}</SummarySnippet>
              )}
            </SignalText>
            <ChipActions>
              <ActionButton
                type="button"
                $primary
                disabled={busy}
                aria-label={`Accept ${meta.label} for ${meta.targetAppLabel}`}
                data-testid={`thread-signal-accept-${signal.id}`}
                onClick={() => void run(signal.id, () => onAccept(signal.id))}
              >
                <Check size={10} aria-hidden="true" />
                Accept
              </ActionButton>
              <ActionButton
                type="button"
                disabled={busy}
                aria-label={`Dismiss ${meta.label}`}
                data-testid={`thread-signal-dismiss-${signal.id}`}
                onClick={() => void run(signal.id, () => onDismiss(signal.id))}
              >
                <X size={10} aria-hidden="true" />
                Dismiss
              </ActionButton>
            </ChipActions>
          </SignalChip>
        )
      })}
    </Strip>
  )
}
