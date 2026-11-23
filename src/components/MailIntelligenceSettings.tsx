import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { styled } from 'styled-components'
import { MAIL_SIGNAL_KINDS, type MailSignalKind } from '@purescience/platform-ui/bridge/mailHub'
import { Badge } from '@purescience/platform-ui/components/common/feedback/Badge'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import type { MailHubHistoryScanState } from '../hooks/useMailHubIntegration'
import {
  countMessagesInHistoryRange,
  effectiveEnabledSignalKinds,
  formatHistoryRangeLabel,
  hasAnyMailIntelligenceFeatureEnabled,
  MAIL_SIGNAL_GROUPS,
  resolveMailIntelligenceSettings,
} from '../lib/mailHubSync'
import type {
  MailIntelligenceHistoryRange,
  MailIntelligenceHistoryUnit,
  MailIntelligenceLastScanSummary,
  MailIntelligenceSettings as MailIntelligenceSettingsType,
  MailStore,
} from '../types'
import {
  ComposeInput,
  Meta,
  SelectField,
  SettingToggle,
  SettingsActions,
  SettingsCard,
  SettingsCardHeader,
  Subject,
} from './mailShellStyles'

export interface MailIntelligenceSettingsProps {
  store: MailStore
  setStore: Dispatch<SetStateAction<MailStore>>
  hubAvailable: boolean
  historyScan: MailHubHistoryScanState
  onRunHistoryScan: (
    range: MailIntelligenceHistoryRange,
  ) => Promise<MailIntelligenceLastScanSummary | null>
  onCancelHistoryScan: () => void
}

type HistoryPresetId = '7d' | '30d' | '3m' | '12m' | 'custom' | 'all'

const PRESETS: ReadonlyArray<{
  id: HistoryPresetId
  label: string
  range?: MailIntelligenceHistoryRange
}> = [
  { id: '7d', label: '7 days', range: { mode: 'window', amount: 7, unit: 'days' } },
  { id: '30d', label: '30 days', range: { mode: 'window', amount: 30, unit: 'days' } },
  { id: '3m', label: '3 months', range: { mode: 'window', amount: 3, unit: 'months' } },
  { id: '12m', label: '1 year', range: { mode: 'window', amount: 12, unit: 'months' } },
  { id: 'custom', label: 'Custom' },
  { id: 'all', label: 'All emails', range: { mode: 'all' } },
]

function detectPreset(range: MailIntelligenceHistoryRange): HistoryPresetId {
  if (range.mode === 'all') return 'all'
  const amount = Math.max(1, Math.floor(range.amount ?? 30))
  const unit = range.unit ?? 'days'
  if (unit === 'days' && amount === 7) return '7d'
  if (unit === 'days' && amount === 30) return '30d'
  if (unit === 'months' && amount === 3) return '3m'
  if (unit === 'months' && amount === 12) return '12m'
  return 'custom'
}

const SectionDivider = styled.div`
  border-top: 1px solid var(--n-line, rgba(128, 128, 128, 0.16));
  margin: 14px 0;
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const FeatureList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const FeatureRow = styled.label`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--n-line, rgba(128, 128, 128, 0.16));
  background: var(--n-surface, transparent);
  cursor: pointer;
  transition: border-color 120ms ease;

  &:hover {
    border-color: var(--n-line-strong, rgba(128, 128, 128, 0.34));
  }

  input {
    margin-top: 2px;
    flex-shrink: 0;
  }
`

const FeatureCopy = styled.span`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`

const FeatureTitle = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: var(--n-ink, inherit);
`

const FeatureHelp = styled.span`
  font-size: 12px;
  line-height: 1.4;
  color: var(--n-muted, #6b7280);
`

const SignalGroupGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  margin-left: 22px;
  margin-top: 2px;
`

const SignalGroupCard = styled.label<{ $active: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 7px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? 'var(--n-accent, #b45309)'
        : 'var(--n-line, rgba(128, 128, 128, 0.16))'};
  background: ${({ $active }) =>
    $active ? 'rgba(180, 83, 9, 0.06)' : 'transparent'};
  cursor: pointer;

  input {
    margin-top: 2px;
    flex-shrink: 0;
  }
`

const PresetRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`

const PresetChip = styled.button<{ $active: boolean }>`
  appearance: none;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? 'var(--n-accent, #b45309)'
        : 'var(--n-line, rgba(128, 128, 128, 0.24))'};
  background: ${({ $active }) =>
    $active ? 'var(--n-accent, #b45309)' : 'transparent'};
  color: ${({ $active }) => ($active ? '#ffffff' : 'var(--n-ink, inherit)')};
  border-radius: 999px;
  padding: 4px 11px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;

  &:hover:not(:disabled) {
    border-color: var(--n-accent, #b45309);
  }
`

const CustomRangeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const ProgressBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--n-line, rgba(128, 128, 128, 0.2));
  background: var(--n-surface-2, rgba(128, 128, 128, 0.05));
`

const ProgressTrack = styled.div`
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: var(--n-line, rgba(128, 128, 128, 0.2));
  overflow: hidden;
`

const ProgressFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => `${Math.max(2, Math.min(100, $pct))}%`};
  background: var(--n-accent, #b45309);
  border-radius: 999px;
  transition: width 150ms ease;
`

const PrivacyGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
`

const FieldBlock = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--n-muted, #6b7280);
`

function parseCsvList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
}

export function MailIntelligenceSettings({
  store,
  setStore,
  hubAvailable,
  historyScan,
  onRunHistoryScan,
  onCancelHistoryScan,
}: MailIntelligenceSettingsProps) {
  const settings = useMemo(() => resolveMailIntelligenceSettings(store), [store])
  const activeKinds = useMemo(
    () => new Set<MailSignalKind>(effectiveEnabledSignalKinds(settings)),
    [settings],
  )
  const initialRange = settings.defaultHistoryRange ?? {
    mode: 'window',
    amount: 30,
    unit: 'days',
  }

  const [preset, setPreset] = useState<HistoryPresetId>(() =>
    detectPreset(initialRange),
  )
  const [customAmountText, setCustomAmountText] = useState<string>(() =>
    String(initialRange.mode === 'window' ? Math.max(1, initialRange.amount ?? 14) : 14),
  )
  const [customUnit, setCustomUnit] = useState<MailIntelligenceHistoryUnit>(() =>
    initialRange.mode === 'window' ? (initialRange.unit ?? 'days') : 'days',
  )
  const [neverReadSendersText, setNeverReadSendersText] = useState<string>(() =>
    (settings.neverReadSenders ?? []).join(', '),
  )
  const [neverReadDomainsText, setNeverReadDomainsText] = useState<string>(() =>
    (settings.neverReadDomains ?? []).join(', '),
  )

  const selectedRange: MailIntelligenceHistoryRange = useMemo(() => {
    if (preset === 'all') return { mode: 'all' }
    const found = PRESETS.find(p => p.id === preset)?.range
    if (found) return found
    const parsed = Math.max(1, Math.min(3650, parseInt(customAmountText, 10) || 1))
    return { mode: 'window', amount: parsed, unit: customUnit }
  }, [preset, customAmountText, customUnit])

  const messagesInRange = useMemo(
    () => countMessagesInHistoryRange(store, selectedRange),
    [store, selectedRange],
  )

  const patchSettings = (update: Partial<MailIntelligenceSettingsType>) => {
    setStore(current => {
      const prev = resolveMailIntelligenceSettings(current)
      return {
        ...current,
        settings: {
          ...current.settings,
          mailIntelligence: {
            ...prev,
            ...update,
          },
        },
      }
    })
  }

  const enableAll = () => {
    patchSettings({
      enabled: true,
      signalExtraction: true,
      enabledSignalKinds: undefined,
      crossAppOutbox: true,
      semanticMemory: true,
      voiceProfile: true,
      allowOrgSharing: true,
    })
  }

  const disableAll = () => {
    patchSettings({ enabled: false })
  }

  const togglePart = (
    key:
      | 'signalExtraction'
      | 'crossAppOutbox'
      | 'semanticMemory'
      | 'voiceProfile'
      | 'allowOrgSharing',
    checked: boolean,
  ) => {
    if (!settings.enabled && checked) {
      // Enabling any single capability while master is off turns on ONLY that capability (opt-in in part!).
      patchSettings({
        enabled: true,
        signalExtraction: key === 'signalExtraction',
        crossAppOutbox: key === 'crossAppOutbox',
        semanticMemory: key === 'semanticMemory',
        voiceProfile: key === 'voiceProfile',
        allowOrgSharing: key === 'allowOrgSharing',
      })
      return
    }
    patchSettings({ [key]: checked })
  }

  const toggleSignalGroup = (kinds: readonly MailSignalKind[], checked: boolean) => {
    const base =
      settings.enabled && settings.signalExtraction
        ? new Set<MailSignalKind>(effectiveEnabledSignalKinds(settings))
        : new Set<MailSignalKind>()
    for (const kind of kinds) {
      if (checked) base.add(kind)
      else base.delete(kind)
    }
    const nextList = MAIL_SIGNAL_KINDS.filter(k => base.has(k))
    if (!settings.enabled && checked) {
      patchSettings({
        enabled: true,
        signalExtraction: true,
        enabledSignalKinds: nextList,
        crossAppOutbox: false,
        semanticMemory: false,
        voiceProfile: false,
        allowOrgSharing: false,
      })
      return
    }
    patchSettings({
      signalExtraction: nextList.length > 0,
      enabledSignalKinds:
        nextList.length === MAIL_SIGNAL_KINDS.length ? undefined : nextList,
    })
  }

  const allFeaturesOn =
    settings.enabled &&
    settings.signalExtraction &&
    activeKinds.size === MAIL_SIGNAL_KINDS.length &&
    settings.crossAppOutbox &&
    settings.semanticMemory &&
    settings.voiceProfile
  const anyFeatureOn = hasAnyMailIntelligenceFeatureEnabled(settings)

  const statusBadge = !anyFeatureOn
    ? { label: 'Off', tone: 'neutral' as const }
    : allFeaturesOn
      ? { label: 'All enabled', tone: 'accent' as const }
      : { label: 'Partial', tone: 'accent' as const }

  const progress = historyScan.progress
  const progressPct =
    progress && progress.totalMessages > 0
      ? Math.round((progress.scannedMessages / progress.totalMessages) * 100)
      : progress?.phase === 'done'
        ? 100
        : 0

  const canRunScan =
    anyFeatureOn &&
    hubAvailable &&
    !historyScan.running &&
    messagesInRange > 0

  return (
    <SettingsCard>
      <SettingsCardHeader>
        <div>
          <Subject>Mail Intelligence Hub</Subject>
          <Meta>
            Optional cross-app intelligence powered locally by PureDesktop. Enable everything or turn on only the pieces you want — nothing is ever sent automatically.
          </Meta>
        </div>
        <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
      </SettingsCardHeader>

      <SettingsActions>
        <SettingToggle>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={e => patchSettings({ enabled: e.target.checked })}
          />
          Enable Mail Intelligence Hub
        </SettingToggle>
        <Button size="sm" variant="subtle" onClick={enableAll}>
          Enable all
        </Button>
        <Button
          size="sm"
          variant="text"
          disabled={!settings.enabled}
          onClick={disableAll}
        >
          Turn off
        </Button>
      </SettingsActions>

      <SectionDivider>
        <FeatureTitle>Choose what to enable</FeatureTitle>
        <FeatureList>
          <div>
            <FeatureRow>
              <input
                type="checkbox"
                checked={settings.enabled && settings.signalExtraction}
                onChange={e => togglePart('signalExtraction', e.target.checked)}
              />
              <FeatureCopy>
                <FeatureTitle>Cross-app signal extraction &amp; thread action chips</FeatureTitle>
                <FeatureHelp>
                  Detect receipts, invoices, tasks, project waits, contracts, signing PDFs, and shared papers and surface 1-click chips inside threads.
                </FeatureHelp>
              </FeatureCopy>
            </FeatureRow>
            {settings.enabled && settings.signalExtraction && (
              <SignalGroupGrid aria-label="Signal categories">
                {MAIL_SIGNAL_GROUPS.map(group => {
                  const groupChecked = group.kinds.every(k => activeKinds.has(k))
                  return (
                    <SignalGroupCard key={group.id} $active={groupChecked}>
                      <input
                        type="checkbox"
                        checked={groupChecked}
                        onChange={e => toggleSignalGroup(group.kinds, e.target.checked)}
                      />
                      <FeatureCopy>
                        <FeatureTitle>{group.label}</FeatureTitle>
                        <FeatureHelp>{group.targetApps}</FeatureHelp>
                      </FeatureCopy>
                    </SignalGroupCard>
                  )
                })}
              </SignalGroupGrid>
            )}
          </div>

          <FeatureRow>
            <input
              type="checkbox"
              checked={settings.enabled && settings.crossAppOutbox}
              onChange={e => togglePart('crossAppOutbox', e.target.checked)}
            />
            <FeatureCopy>
              <FeatureTitle>Cross-App Outbox Review &amp; closed-loop reply tracking</FeatureTitle>
              <FeatureHelp>
                Review drafts staged by PureInvoicing, PureOutreach, PureMeet, and PureExecutive here, and notify them automatically when you send or receive a reply.
              </FeatureHelp>
            </FeatureCopy>
          </FeatureRow>

          <FeatureRow>
            <input
              type="checkbox"
              checked={settings.enabled && settings.semanticMemory}
              onChange={e => togglePart('semanticMemory', e.target.checked)}
            />
            <FeatureCopy>
              <FeatureTitle>Local semantic mail search &amp; Pre-Meeting Dossiers</FeatureTitle>
              <FeatureHelp>
                Index opted-in email locally on this device so agents in PureMeet, PureCalendar, PureRedline, and PureWriter can cite past threads and build meeting briefs.
              </FeatureHelp>
            </FeatureCopy>
          </FeatureRow>

          <FeatureRow>
            <input
              type="checkbox"
              checked={settings.enabled && settings.voiceProfile}
              onChange={e => togglePart('voiceProfile', e.target.checked)}
            />
            <FeatureCopy>
              <FeatureTitle>Writing voice profile (from local Sent mail)</FeatureTitle>
              <FeatureHelp>
                Learn your greeting, tone, brevity, and sign-off patterns locally so reply drafts sound like you — never copies raw email bodies.
              </FeatureHelp>
            </FeatureCopy>
          </FeatureRow>

          <FeatureRow>
            <input
              type="checkbox"
              checked={settings.enabled && settings.allowOrgSharing}
              onChange={e => togglePart('allowOrgSharing', e.target.checked)}
            />
            <FeatureCopy>
              <FeatureTitle>Organisation sharing (PureExecutive &amp; PureCloud)</FeatureTitle>
              <FeatureHelp>
                Allow accounts linked to an organisation share to feed executive briefings and org-scoped mail memory. Personal accounts always stay strictly local.
              </FeatureHelp>
            </FeatureCopy>
          </FeatureRow>
        </FeatureList>
      </SectionDivider>

      <SectionDivider>
        <div>
          <FeatureTitle>Run on mail history</FeatureTitle>
          <Meta>
            After changing any setting above, backfill existing mail across a time window or your entire loaded mailbox.
          </Meta>
        </div>

        <PresetRow role="group" aria-label="History scan range">
          {PRESETS.map(item => (
            <PresetChip
              key={item.id}
              type="button"
              $active={preset === item.id}
              disabled={historyScan.running}
              onClick={() => {
                setPreset(item.id)
                if (item.range) {
                  patchSettings({ defaultHistoryRange: item.range })
                }
              }}
            >
              {item.label}
            </PresetChip>
          ))}
        </PresetRow>

        {preset === 'custom' && (
          <CustomRangeRow>
            <Meta>Scan last</Meta>
            <ComposeInput
              aria-label="History scan amount"
              type="number"
              min={1}
              max={3650}
              style={{ width: 84 }}
              value={customAmountText}
              disabled={historyScan.running}
              onChange={e => setCustomAmountText(e.target.value)}
            />
            <SelectField
              aria-label="History scan unit"
              value={customUnit}
              disabled={historyScan.running}
              onChange={e =>
                setCustomUnit(e.target.value as MailIntelligenceHistoryUnit)
              }
            >
              <option value="days">days</option>
              <option value="weeks">weeks</option>
              <option value="months">months</option>
            </SelectField>
          </CustomRangeRow>
        )}

        <SettingsActions>
          <Button
            size="sm"
            variant="primary"
            disabled={!canRunScan}
            onClick={() => void onRunHistoryScan(selectedRange)}
          >
            {historyScan.running
              ? 'Scanning history…'
              : selectedRange.mode === 'all'
                ? `Run on all ${messagesInRange.toLocaleString()} emails`
                : `Run on ${formatHistoryRangeLabel(selectedRange).toLowerCase()} (${messagesInRange.toLocaleString()})`}
          </Button>
          {historyScan.running && (
            <Button size="sm" variant="subtle" onClick={onCancelHistoryScan}>
              Cancel
            </Button>
          )}
          <Meta>
            {!hubAvailable
              ? 'Connect PureDesktop shell bridge to run history scans.'
              : !anyFeatureOn
                ? 'Enable at least one capability above to scan history.'
                : `${messagesInRange.toLocaleString()} ${messagesInRange === 1 ? 'email' : 'emails'} in scope`}
          </Meta>
        </SettingsActions>

        {historyScan.running && progress && (
          <ProgressBox aria-live="polite">
            <ProgressTrack>
              <ProgressFill $pct={progressPct} />
            </ProgressTrack>
            <Meta>
              Scanned {progress.scannedMessages.toLocaleString()} /{' '}
              {progress.totalMessages.toLocaleString()} emails ({progressPct}%) ·{' '}
              {progress.signalsExtracted.toLocaleString()} signals ·{' '}
              {progress.voiceSamplesAnalyzed.toLocaleString()} sent analyzed
            </Meta>
          </ProgressBox>
        )}

        {!historyScan.running && settings.lastHistoryScan && (
          <ProgressBox>
            <Meta>
              <strong>
                {settings.lastHistoryScan.cancelled
                  ? 'Last scan stopped'
                  : 'Last scan'}
                :
              </strong>{' '}
              {settings.lastHistoryScan.rangeLabel} ·{' '}
              {settings.lastHistoryScan.scannedMessages.toLocaleString()} scanned ·{' '}
              {settings.lastHistoryScan.signalsExtracted.toLocaleString()} signals
              {settings.lastHistoryScan.voiceSamplesAnalyzed > 0
                ? ` · ${settings.lastHistoryScan.voiceSamplesAnalyzed.toLocaleString()} sent analyzed for voice`
                : ''}
              {settings.lastHistoryScan.blockedByPrivacy > 0
                ? ` · ${settings.lastHistoryScan.blockedByPrivacy.toLocaleString()} skipped by privacy rules`
                : ''}
            </Meta>
          </ProgressBox>
        )}
      </SectionDivider>

      <SectionDivider>
        <FeatureTitle>Privacy exclusions</FeatureTitle>
        <PrivacyGrid>
          <FieldBlock>
            Never read senders (comma-separated emails)
            <ComposeInput
              placeholder="doctor@clinic.org, private@example.com"
              value={neverReadSendersText}
              onChange={e => setNeverReadSendersText(e.target.value)}
              onBlur={() =>
                patchSettings({
                  neverReadSenders: parseCsvList(neverReadSendersText),
                })
              }
            />
          </FieldBlock>
          <FieldBlock>
            Never read domains (comma-separated)
            <ComposeInput
              placeholder="mybank.com, medical-portal.org"
              value={neverReadDomainsText}
              onChange={e => setNeverReadDomainsText(e.target.value)}
              onBlur={() =>
                patchSettings({
                  neverReadDomains: parseCsvList(neverReadDomainsText).map(d =>
                    d.replace(/^@+/, ''),
                  ),
                })
              }
            />
          </FieldBlock>
        </PrivacyGrid>
      </SectionDivider>
    </SettingsCard>
  )
}
