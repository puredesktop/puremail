import { Archive, Globe, Mail } from 'lucide-react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import type { UnsubscribeCandidate } from '../lib/mailUnsubscribe'
import {
  DrawerAction,
  DrawerActionList,
  Kicker,
  Meta,
  Section,
  Subject,
  TaskDrawer,
  TaskDrawerBackdrop,
} from './mailShellStyles'

export interface UnsubscribeDrawerProps {
  candidates: UnsubscribeCandidate[]
  onClose: () => void
  unsubscribeByMail: (candidate: UnsubscribeCandidate) => void
  unsubscribeByLink: (candidate: UnsubscribeCandidate) => void
  archiveSenderThreads: (candidate: UnsubscribeCandidate) => void
}

/**
 * Quiet per-sender unsubscribe surface (Phase M3): senders offering
 * List-Unsubscribe (or an unsubscribe-looking link) grouped with their
 * inbox volume, each with a one-step unsubscribe and optional cleanup.
 */
export function UnsubscribeDrawer({
  candidates,
  onClose,
  unsubscribeByMail,
  unsubscribeByLink,
  archiveSenderThreads,
}: UnsubscribeDrawerProps): React.ReactElement {
  return (
    <TaskDrawerBackdrop onClick={onClose}>
      <TaskDrawer
        aria-label="Unsubscribe candidates"
        onClick={event => event.stopPropagation()}
      >
        <Section>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Kicker>Unsubscribe candidates</Kicker>
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
          <Meta>
            Senders in your inbox that offer an unsubscribe channel.
            Unsubscribing never deletes existing mail.
          </Meta>
        </Section>
        <DrawerActionList>
          {candidates.length === 0 && (
            <Meta>No unsubscribe-capable senders found in the inbox.</Meta>
          )}
          {candidates.map(candidate => (
            <DrawerAction key={candidate.senderEmail} as="div">
              <Subject>{candidate.senderName}</Subject>
              <Meta>
                {candidate.senderEmail} · {candidate.messageCount} message
                {candidate.messageCount === 1 ? '' : 's'} ·{' '}
                {candidate.threadIds.length} thread
                {candidate.threadIds.length === 1 ? '' : 's'}
                {candidate.heuristicOnly
                  ? ' · link found in message body'
                  : ' · List-Unsubscribe header'}
              </Meta>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {candidate.targets.mailto && (
                  <Button
                    size="sm"
                    onClick={() => unsubscribeByMail(candidate)}
                  >
                    <Mail aria-hidden="true" size={13} /> Unsubscribe by email
                  </Button>
                )}
                {candidate.targets.https && (
                  <Button
                    size="sm"
                    onClick={() => unsubscribeByLink(candidate)}
                  >
                    <Globe aria-hidden="true" size={13} /> Open unsubscribe
                    page
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => archiveSenderThreads(candidate)}
                >
                  <Archive aria-hidden="true" size={13} /> Archive{' '}
                  {candidate.threadIds.length} thread
                  {candidate.threadIds.length === 1 ? '' : 's'}
                </Button>
              </div>
            </DrawerAction>
          ))}
        </DrawerActionList>
      </TaskDrawer>
    </TaskDrawerBackdrop>
  )
}
