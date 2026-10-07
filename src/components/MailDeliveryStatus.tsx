import { styled } from 'styled-components'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'

export type MailConnectionState = 'healthy' | 'unknown' | 'checking' | 'offline' | 'error'

const Light = styled.span<{ $state: MailConnectionState }>`
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: ${({ $state }) => $state === 'healthy'
    ? 'color-mix(in srgb, var(--platform-colors-success, #2c8652) 80%, #5ddd87)'
    : $state === 'error' ? 'var(--platform-colors-error, #a54536)'
    : 'var(--platform-colors-text-tertiary, #92959e)'};
`

const Label = styled.span`
  @media (max-width: 640px) { .detail { display: none; } }
`

const labels: Record<MailConnectionState, string> = {
  healthy: 'Receiving and sending connections verified',
  unknown: 'Sending and receiving have not both been verified',
  checking: 'Testing receiving and sending connections',
  offline: 'Offline',
  error: 'Mail connection needs attention',
}

/** The one Test connection button every connection uses: a light for how it stands (green verified, red needs attention, grey unknown), the words on hover. */
export function MailConnectionControl({ state, onTest, words = labels, disabled }: { state: MailConnectionState; onTest: () => void; words?: Record<MailConnectionState, string>; disabled?: boolean }) {
  return <Button size="sm" variant="text" disabled={disabled || state === 'checking'} onClick={onTest}
    title={words[state]} aria-label={`Test connection — ${words[state]}`}>
    <Light $state={state} aria-hidden="true" />
    <Label>{state === 'checking' ? 'Testing…' : <>Test<span className="detail"> connection</span></>}</Label>
  </Button>
}
