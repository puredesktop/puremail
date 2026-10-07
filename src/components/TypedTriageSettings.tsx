import { useEffect, useRef, useState } from 'react'
import { styled } from 'styled-components'
import { Badge } from '@purescience/platform-ui/components/common/feedback/Badge'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { SelectField } from '@purescience/platform-ui/components/common/inputs/SelectField'
import { getTypedJudgmentStatus, type TypedJudgmentStatus } from '@purescience/platform-ui/bridge/typedJudgments.mjs'
import { typedTriageSettings, shadowComparison, triageCandidates } from '../lib/typedTriage'
import { connectionTestMessage, testTypedTriageConnection } from '../lib/typedTriageConnection'
import { readTriageFile } from '../lib/triagePersistence'
import type { MailStore } from '../types'
import { ConnectionResultTitle, ConnectionTestResultBox, Meta, SettingsActions, SettingsCard, SettingsCardHeader, SettingsOptionGrid, Subject, TaskField, type ConnectionResultTone } from './mailShellStyles'
import { MailConnectionControl, type MailConnectionState } from './MailDeliveryStatus'

type Prefs = NonNullable<MailStore['settings']['typedTriage']>
type Mode = Prefs['mode']
type RunOptions = import('../lib/typedTriage').TriageRunOptions
type RunSummary = import('../lib/typedTriage').TriageRunSummary

const TEST_WORDS: Record<MailConnectionState, string> = { healthy: 'Connection verified', unknown: 'Connection not tested in this session', checking: 'Testing with a synthetic message', offline: 'Offline', error: 'Connection needs attention' }
const MODE_WORDS: Record<Mode, { badge: string; tone: 'neutral' | 'accent'; help: string }> = {
  off: { badge: 'Off', tone: 'neutral', help: 'Nothing is classified. Turn on a shadow trial to see how it would do without it showing anything.' },
  shadow: { badge: 'Shadow trial', tone: 'accent', help: 'Results are kept privately and compared with what you and the drawer decide. Nothing shows in the inbox.' },
  suggest: { badge: 'Suggesting', tone: 'accent', help: 'Results that reach the confidence below appear as suggestions in the inbox. Lower ones stay with the drawer.' },
}

/**
 * Automatic triage, in one card: what classifies and how it is used (the
 * provider and the mode), its limits (requests a day, the confidence a
 * suggestion needs), how it stands today (the key, the requests used, the
 * shadow trial so far), the three actions with one result box between them,
 * and, folded away, reclassifying older mail and the recent requests.
 * Every field saves as it is changed, once it is valid.
 */
export function TypedTriageSettings({ store, setStore, onRunTriage }: { store: MailStore; setStore: React.Dispatch<React.SetStateAction<MailStore>>; onRunTriage: (ids?: string[], options?: RunOptions) => Promise<RunSummary> }) {
  const prefs = typedTriageSettings(store)
  const selection = `${prefs.provider}:${prefs.localModel}`
  const selectionRef = useRef(selection); selectionRef.current = selection
  const local = prefs.provider === 'local'
  const threshold = local ? prefs.localConfidence : prefs.confidence
  function patch(update: Partial<Prefs>) { setStore(current => ({ ...current, settings: { ...current.settings, typedTriage: { ...typedTriageSettings(current), ...update } } })) }

  // The two numbers as typed, so each can be cleared and typed afresh; saved once valid.
  const [confidenceText, setConfidenceText] = useState(String(threshold))
  useEffect(() => { setConfidenceText(String(threshold)) }, [threshold, local])
  const validConfidence = confidenceText.trim() !== '' && Number(confidenceText) >= 0.5 && Number(confidenceText) <= 1
  const [capText, setCapText] = useState(String(prefs.dailyCap))
  useEffect(() => { setCapText(String(prefs.dailyCap)) }, [prefs.dailyCap])
  const validCap = /^\d+$/.test(capText.trim()) && Number(capText) >= 1 && Number(capText) <= 1000

  // How it stands: the bridge's status and the shadow trial's tally.
  const [status, setStatus] = useState<TypedJudgmentStatus | null>(null)
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState({ sampled: 0, compared: 0, agree: 0 })
  async function refresh() {
    try { const [s, f] = await Promise.all([getTypedJudgmentStatus(), readTriageFile()]); setStatus(s); setComparison(shadowComparison(f)); setError('') }
    catch { setError('The judgment bridge is unavailable, so automatic triage is inactive.') }
  }
  useEffect(() => { void refresh() }, [])
  const ready = local ? !!(status?.local?.available && prefs.localModel && status.local.models.includes(prefs.localModel)) : !!status?.configured
  const standing = !status ? 'Checking the bridge…'
    : local ? (status.local?.available ? (ready ? `Local model ${prefs.localModel}` : 'Choose an installed local model') : 'Local runtime (Ollama) unavailable')
      : status.configured ? 'TypeSafe key saved' : 'No TypeSafe key: add it in desktop Settings › API keys'

  // One result box for whatever was done last: the test, or a run.
  const [result, setResult] = useState<{ tone: ConnectionResultTone; title: string; detail?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [testState, setTestState] = useState<MailConnectionState>('unknown')
  useEffect(() => { setResult(null); setTestState('unknown') }, [selection])
  async function testConnection() {
    setTesting(true); setTestState('checking'); setResult(null)
    const selected = selection
    try {
      const r = await testTypedTriageConnection(prefs.dailyCap, prefs.provider, prefs.localModel)
      if (selectionRef.current === selected) { const ok = r.status === 'completed'; setTestState(ok ? 'healthy' : 'error'); setResult({ tone: ok ? 'success' : 'warning', title: ok ? 'Connection verified' : 'Connection not verified', detail: connectionTestMessage(r) }) }
    } catch {
      if (selectionRef.current === selected) { setTestState('error'); setResult({ tone: 'warning', title: 'Connection not verified', detail: 'The judgment bridge could not complete the request.' }) }
    } finally { setTesting(false); await refresh() }
  }

  const [running, setRunning] = useState(false)
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [limit, setLimit] = useState(25)
  const candidates = triageCandidates(store, { from, to, limit })
  const rangeError = from && to && from > to ? 'From must be on or before Through.' : !Number.isInteger(limit) || limit < 1 || limit > 1000 ? 'Maximum messages must be between 1 and 1,000.' : ''
  const canRun = !testing && !running && prefs.mode !== 'off' && !rangeError && validConfidence && validCap && candidates.length > 0
  async function runPending() {
    if (!canRun) return
    setRunning(true); setResult({ tone: 'neutral', title: 'Classifying…', detail: `${candidates.length} candidate messages, newest first.` })
    try {
      const r = await onRunTriage(candidates, { reclassify: true })
      const why = r.stopReason ? ` Stopped: ${r.stopReason.replaceAll('-', ' ')}.` : ''
      setResult({ tone: r.completed ? 'success' : 'neutral', title: `${r.completed} ${r.completed === 1 ? 'message' : 'messages'} classified`, detail: r.completed === 0 ? `No eligible messages were classified; messages you or the drawer already judged are protected.${why}` : `${prefs.mode === 'shadow' ? 'Kept privately for the shadow trial.' : 'Those reaching your confidence appear as suggestions.'}${why}` })
    } catch { setResult({ tone: 'warning', title: 'Triage could not finish', detail: 'Check the connection, then refresh the status for details.' }) }
    finally { setRunning(false); await refresh() }
  }

  const mode = MODE_WORDS[prefs.mode]
  return <SettingsCard id="settings-typed-triage">
    <SettingsCardHeader>
      <div>
        <Subject>Automatic triage</Subject>
        <Meta>{local ? 'Classifies recent incoming mail with the model in your local Ollama runtime; nothing leaves this computer.' : 'Sends recent incoming mail excerpts and sender details to TypeSafe to classify.'} Bulk mail is skipped. No mail is moved or sent.</Meta>
      </div>
      <Badge tone={mode.tone}>{mode.badge}</Badge>
    </SettingsCardHeader>

    <SettingsOptionGrid>
      <TaskField>Classified by
        <SelectField aria-label="Triage provider" value={prefs.provider} options={[{ value: 'typesafe', label: 'TypeSafe' }, { value: 'local', label: 'Local model (Ollama)' }]} onValueChange={provider => patch({ provider: provider as Prefs['provider'] })} />
      </TaskField>
      <TaskField>Used as
        <SelectField aria-label="Automatic triage mode" value={prefs.mode} options={[{ value: 'off', label: 'Off' }, { value: 'shadow', label: 'Shadow trial' }, { value: 'suggest', label: 'Suggestions in the inbox' }]} onValueChange={m => patch({ mode: m as Mode })} />
      </TaskField>
      {local && <TaskField>Local model
        <SelectField aria-label="Local triage model" value={prefs.localModel} options={[{ value: '', label: 'Choose an installed model' }, ...(status?.local?.models ?? []).map(value => ({ value, label: value }))]} onValueChange={localModel => patch({ localModel })} />
      </TaskField>}
    </SettingsOptionGrid>
    <Meta>{mode.help}{local ? ' A local model’s confidence is self-reported, not a calibrated score: try a shadow trial before suggestions.' : ''}</Meta>

    <SettingsOptionGrid>
      <TaskField>Requests a day, at most
        <NumberField aria-label="Triage daily cap" type="number" inputMode="numeric" min={1} max={1000} step={1} value={capText} aria-invalid={!validCap}
          onChange={e => { const v = e.target.value; setCapText(v); if (/^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 1000) patch({ dailyCap: Number(v) }) }} />
        <Meta>{validCap ? 'Failed attempts and connection tests count too.' : 'A whole number from 1 to 1,000.'}</Meta>
      </TaskField>
      <TaskField>{local ? 'Confidence a suggestion needs (self-reported)' : 'Confidence a suggestion needs'}
        <NumberField aria-label="Triage confidence" type="number" inputMode="decimal" min={0.5} max={1} step={0.05} value={confidenceText} aria-invalid={!validConfidence}
          onChange={e => { const v = e.target.value; setConfidenceText(v); const c = Number(v); if (v.trim() !== '' && c >= 0.5 && c <= 1) patch(local ? { localConfidence: c } : { confidence: c }) }} />
        <Meta>{validConfidence ? 'From 0.5 to 1. Results below it stay with the drawer.' : 'A number from 0.5 to 1.'}</Meta>
      </TaskField>
    </SettingsOptionGrid>

    <Facts>
      <div><dt>Today</dt><dd>{status ? `${status.today} of ${prefs.dailyCap} requests` : '—'}</dd></div>
      <div><dt>{local ? 'Model' : 'Key'}</dt><dd>{standing}</dd></div>
      <div><dt>Shadow trial</dt><dd>{comparison.sampled ? `${comparison.sampled} results · ${comparison.compared} compared with your judgments · ${comparison.agree} agree` : 'No results yet'}</dd></div>
    </Facts>
    {error && <Meta role="alert">{error}</Meta>}

    <SettingsActions>
      <MailConnectionControl state={testState} words={TEST_WORDS} disabled={testing || running || !ready} onTest={() => void testConnection()} />
      <Button size="sm" disabled={!canRun} title={prefs.mode === 'off' ? 'Turn triage on first' : !candidates.length ? 'No recent messages to classify' : `Classifies the ${candidates.length} newest candidate messages now, reclassifying earlier results`} onClick={() => void runPending()}>{running ? 'Running triage…' : 'Run triage now'}</Button>
      <Button size="sm" variant="text" disabled={testing || running} onClick={() => void refresh()}>Refresh status</Button>
    </SettingsActions>
    {result && <ConnectionTestResultBox $tone={result.tone} role="status" aria-live="polite">
      <ConnectionResultTitle>{result.title}</ConnectionResultTitle>
      {result.detail && <Meta>{result.detail}</Meta>}
    </ConnectionTestResultBox>}
    <Meta>A test sends one synthetic message, never your mail. Background triage checks unprocessed mail from the last day by itself; Run triage now reclassifies the messages chosen below.</Meta>

    <Fold>
      <summary>Reclassify older mail</summary>
      <Meta>The newest incoming message of each conversation in the range, up to the count; bulk mail and messages you or the drawer judged are left alone. Each counts toward the day’s requests.</Meta>
      <SettingsActions>
        <TaskField>From<input aria-label="Reclassify from date" type="date" value={from} onChange={e => setFrom(e.target.value)} /></TaskField>
        <TaskField>Through<input aria-label="Reclassify through date" type="date" value={to} onChange={e => setTo(e.target.value)} /></TaskField>
        <TaskField>Up to<NumberField aria-label="Reclassify maximum messages" type="number" min={1} max={1000} value={limit} onChange={e => setLimit(Number(e.target.value))} /></TaskField>
      </SettingsActions>
      {rangeError && <Meta role="alert">{rangeError}</Meta>}
      <SettingsActions>
        <Button size="sm" disabled={!canRun} onClick={() => void runPending()}>{running ? 'Running triage…' : `Reclassify ${candidates.length} ${candidates.length === 1 ? 'message' : 'messages'}`}</Button>
      </SettingsActions>
    </Fold>

    {status && status.recent.length > 0 && <Fold>
      <summary>Recent requests</summary>
      <Requests>{status.recent.map(item => <li key={item.id}><span>{new Date(item.at).toLocaleTimeString()}</span><span>{item.status}</span><span>{item.latencyMs ?? '—'} ms</span><span>{item.inputTokens ?? '—'} in · {item.outputTokens ?? '—'} out</span></li>)}</Requests>
      <Meta>Tokens, not prices: the provider’s charge is not known here.</Meta>
    </Fold>}
  </SettingsCard>
}

const NumberField = styled.input`
  width: 120px;
  padding: 6px 8px;
  font: inherit;
  color: var(--platform-colors-text);
  background: var(--platform-colors-surface);
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  &[aria-invalid="true"] { border-color: var(--platform-colors-warning, var(--puremail-warning-text)); }
`
const Facts = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 16px;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  > div { min-width: 0; }
  dt { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--platform-colors-text-secondary); }
  dd { margin: 2px 0 0; font-size: var(--pure-chrome-ui-size); line-height: 1.4; overflow-wrap: anywhere; }
`
const Fold = styled.details`
  display: grid;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--platform-colors-border-subtle);
  border-radius: var(--platform-radius-sm);
  summary { cursor: pointer; font-weight: 600; font-size: var(--pure-chrome-ui-size); }
  &:not([open]) { gap: 0; }
`
const Requests = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
  li { display: grid; grid-template-columns: 90px 90px 70px minmax(0, 1fr); gap: 12px; font-size: 12px; color: var(--platform-colors-text-secondary); font-variant-numeric: tabular-nums; }
`
