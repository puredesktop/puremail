import { ArrowLeft, LayoutGrid, Plus } from 'lucide-react'
import { runProgress, runStatusLabel } from '../lib/mailRuns'
import type { MailRun } from '../types'
import {
  RunHeaderBack,
  RunHeaderBar,
  RunHeaderButton,
  RunHeaderMeta,
  RunHeaderName,
  RunHeaderSpacer,
  RunPrimaryButton,
  RunsIndexEmpty,
  RunsIndexList,
  RunsIndexMeta,
  RunsIndexName,
  RunsIndexRow,
  RunsIndexScroll,
  RunsIndexSection,
  RunSurface,
} from './runStyles'

export interface RunsIndexProps {
  runs: MailRun[]
  onBack: () => void
  onNewRun: () => void
  onOpen: (runId: string) => void
  onOpenSetup: (runId: string) => void
  onArchive: (runId: string) => void
}

function updatedLabel(iso: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return ''
  const now = new Date()
  const sameDay = when.toDateString() === now.toDateString()
  return sameDay
    ? when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * The Runs index: every run not yet archived, in progress first. A run
 * opens where it stopped; a run still in setup opens its setup; a done
 * run shows its summary and can be archived off the rail.
 */
export function RunsIndex({
  runs,
  onBack,
  onNewRun,
  onOpen,
  onOpenSetup,
  onArchive,
}: RunsIndexProps): React.ReactElement {
  const active = runs.filter(run => run.status !== 'done' && !run.archivedAt)
  const done = runs.filter(run => run.status === 'done' && !run.archivedAt)
  const row = (run: MailRun): React.ReactElement => {
    const progress = runProgress(run)
    const open = (): void =>
      run.status === 'setup' ? onOpenSetup(run.id) : onOpen(run.id)
    return (
      <RunsIndexRow key={run.id}>
        <RunsIndexName type="button" onClick={open} title={run.name}>
          {run.name}
        </RunsIndexName>
        <RunsIndexMeta>{runStatusLabel(run)}</RunsIndexMeta>
        {progress.skipped > 0 && (
          <RunsIndexMeta>{progress.skipped} skipped</RunsIndexMeta>
        )}
        <RunsIndexMeta>{updatedLabel(run.updatedAt)}</RunsIndexMeta>
        <RunHeaderButton type="button" onClick={open}>
          {run.status === 'setup'
            ? 'Continue setup'
            : run.status === 'paused'
              ? 'Resume'
              : run.status === 'done'
                ? 'Review'
                : run.status === 'ready'
                  ? 'Start'
                  : 'Continue'}
        </RunHeaderButton>
        {run.status === 'done' && (
          <RunHeaderButton type="button" onClick={() => onArchive(run.id)}>
            Archive
          </RunHeaderButton>
        )}
      </RunsIndexRow>
    )
  }
  return (
    <RunSurface aria-label="Send runs">
      <RunHeaderBar>
        <RunHeaderBack type="button" aria-label="Back to mail" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </RunHeaderBack>
        <LayoutGrid aria-hidden="true" size={14} />
        <RunHeaderName>Runs</RunHeaderName>
        <RunHeaderMeta>
          {active.length} active
          {done.length ? ` · ${done.length} done` : ''}
        </RunHeaderMeta>
        <RunHeaderSpacer />
        <RunPrimaryButton type="button" onClick={onNewRun}>
          <Plus aria-hidden="true" />
          New run
        </RunPrimaryButton>
      </RunHeaderBar>
      <RunsIndexScroll>
        {runs.length === 0 && (
          <RunsIndexEmpty>
            <strong>A run is a personalised message to a list, reviewed one
            draft at a time.</strong>
            <span>
              Write a template with fields like {'{{first_name}}'} and a
              personal-note slot, attach a recipient list (PureSheets, CSV or
              pasted addresses), render the drafts, then Send &amp; next
              through them. Nothing sends without you pressing Send on each
              one — a run never bulk-sends.
            </span>
            <span>
              You can also select drafts in Drafts and choose{' '}
              <em>Review &amp; send as a run</em> to loop through drafts you
              already have.
            </span>
          </RunsIndexEmpty>
        )}
        {active.length > 0 && (
          <>
            <RunsIndexSection>In progress</RunsIndexSection>
            <RunsIndexList>{active.map(row)}</RunsIndexList>
          </>
        )}
        {done.length > 0 && (
          <>
            <RunsIndexSection>Done</RunsIndexSection>
            <RunsIndexList>{done.map(row)}</RunsIndexList>
          </>
        )}
      </RunsIndexScroll>
    </RunSurface>
  )
}
