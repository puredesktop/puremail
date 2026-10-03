import { styled } from 'styled-components'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'

export type MailConnectionState = 'healthy' | 'unknown' | 'checking' | 'offline' | 'error'

const Light = styled.span<{ $state: MailConnectionState }>`
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: ${({ $state }) => $state === 'healthy'
    ? 'var(--platform-colors-success, #2c8652)'
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

export function MailConnectionControl({ state, onTest }: { state: MailConnectionState; onTest: () => void }) {
  return <Button size="sm" variant="text" disabled={state === 'checking'} onClick={onTest}
    title={labels[state]} aria-label={`Test connection — ${labels[state]}`}>
    <Light $state={state} aria-hidden="true" />
    <Label>{state === 'checking' ? 'Testing…' : <>Test<span className="detail"> connection</span></>}</Label>
  </Button>
}
