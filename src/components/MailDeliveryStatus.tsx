import { styled } from 'styled-components'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import type { Draft } from '../types'

const Status = styled.div<{ $warning: boolean }>`
  flex: none;
  padding: 10px 16px;
  background: ${({ $warning }) => $warning ? '#fff2ee' : 'var(--platform-colors-surface, #fffaf0)'};
  color: ${({ $warning }) => $warning ? 'var(--platform-colors-error, #9e3025)' : 'inherit'};
  max-height: 180px;
  overflow-y: auto;
  border-bottom: 1px solid var(--platform-colors-border, #ddd);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  p { margin: 0; }
  button { margin-left: 8px; }
`

export function MailDeliveryStatus({ offline, connected, checking, checked, syncError, failedDrafts, sendingCount, onCheck, onOpenDraft, onAllowRetry, onResolveConflict, deliveryWarnings = [], draftSaveWarnings = [], onRetryDraftSave, connectionTest, onTest, testing }:{
  connectionTest?: { receiving: string; sending: string } | null
  onTest?: () => void
  testing?: boolean
  offline: boolean
  connected: boolean
  checking: boolean
  checked: boolean
  syncError: string | null
  failedDrafts: Draft[]
  sendingCount: number
  onRetryDraftSave?: (draft: Draft) => void
  draftSaveWarnings?: Draft[]
  deliveryWarnings?: string[]
  onResolveConflict?: (draft: Draft, useRemote: boolean) => void
  onAllowRetry?: (draft: Draft) => void
  onCheck: () => void
  onOpenDraft: (draft: Draft) => void
}) {
  const testFailed = !!connectionTest && [connectionTest.receiving, connectionTest.sending].some(value => /failed|timed out|not verified/i.test(value))
  const connection = offline ? 'Offline — mail cannot be sent or received.'
    : !connected ? 'Mail account disconnected — messages cannot be sent.'
    : syncError ? `Cannot reach your mailbox — showing previously synced mail. ${syncError}`
    : checking || !checked ? 'Checking mail connection…' : null
  if (!onTest && !connection && !failedDrafts.length && !sendingCount && !deliveryWarnings.length && !draftSaveWarnings.length) return null
  return <Status $warning={testFailed || offline || !!syncError || !connected || failedDrafts.length > 0 || deliveryWarnings.length > 0 || draftSaveWarnings.length > 0} role={testFailed || offline || syncError || !connected || failedDrafts.length || deliveryWarnings.length || draftSaveWarnings.length ? 'alert' : 'status'} aria-label="Mail connection and delivery">
    {onTest && <p><strong>{offline ? 'Offline' : syncError || !connected || testFailed ? 'Mail needs attention' : checked ? connectionTest && !testFailed ? 'Connections checked' : 'Receiving connected · Sending not checked' : 'Mail connection not yet checked'}</strong><Button size="sm" variant="text" disabled={offline || !connected || testing} onClick={onTest}>{testing ? 'Testing…' : 'Test receiving / sending'}</Button></p>}
    {connectionTest && <p>Receiving: {connectionTest.receiving}<br />Sending: {connectionTest.sending}</p>}
    {connection && <p><strong>{connection}</strong>{!offline && <Button size="sm" variant="text" disabled={checking} onClick={onCheck}>Check connection</Button>}</p>}
    {sendingCount > 0 && <p>Sending {sendingCount === 1 ? 'message' : `${sendingCount} messages`}… awaiting confirmation.</p>}
    {failedDrafts.length > 0 && <p><strong>{failedDrafts.length === 1 ? '1 message needs attention — send not confirmed.' : `${failedDrafts.length} messages need attention — send not confirmed.`}</strong> Saved in Drafts. Nothing will be resent automatically.</p>}
    {failedDrafts.map(draft => <p key={draft.id}><strong>{draft.subject || '(No subject)'}</strong>: {draft.sendError}<Button size="sm" variant="text" onClick={() => onOpenDraft(draft)}>Open draft</Button>{draft.sendState === 'uncertain' && onAllowRetry && <Button size="sm" variant="text" onClick={() => onAllowRetry(draft)}>I checked Sent — allow retry</Button>}</p>)}
    {failedDrafts.filter(draft => draft.providerConflict).map(draft => <details key={`conflict-${draft.id}`}><summary>Compare conflicting drafts: {draft.subject}</summary><p><strong>This draft</strong></p><pre style={{ whiteSpace: 'pre-wrap' }}>{draft.body}</pre><p><strong>Account version</strong></p><pre style={{ whiteSpace: 'pre-wrap' }}>{draft.providerConflict!.body}</pre><Button size="sm" onClick={() => onResolveConflict?.(draft, true)}>Use account version</Button><Button size="sm" variant="text" onClick={() => onResolveConflict?.(draft, false)}>Keep my version</Button></details>)}
    {draftSaveWarnings.map(draft => <p key={`draft-save-${draft.id}`}><strong>Draft sync needs attention.</strong> {draft.subject}: {draft.providerSaveWarning}{draft.providerSaveUncertain && <Button size="sm" variant="text" onClick={() => onRetryDraftSave?.(draft)}>I checked Drafts — retry saving</Button>}</p>)}
    {deliveryWarnings.map((warning, index) => <p key={index}><strong>Sent, but needs attention.</strong> {warning}</p>)}
  </Status>
}
