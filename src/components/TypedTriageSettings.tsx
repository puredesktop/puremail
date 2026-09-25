import { useEffect, useRef, useState } from 'react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { SelectField } from '@purescience/platform-ui/components/common/inputs/SelectField'
import { getTypedJudgmentStatus, type TypedJudgmentStatus } from '@purescience/platform-ui/bridge/typedJudgments.mjs'
import { typedTriageSettings, shadowComparison, triageCandidates } from '../lib/typedTriage'
import { connectionTestMessage, testTypedTriageConnection } from '../lib/typedTriageConnection'
import { readTriageFile } from '../lib/triagePersistence'
import type { MailStore } from '../types'
import { SettingsCard, Subject, Meta, SettingsFullRow } from './mailShellStyles'
export function TypedTriageSettings({store,setStore,onRunTriage}:{store:MailStore;setStore:React.Dispatch<React.SetStateAction<MailStore>>;onRunTriage:(ids?:string[],options?:import('../lib/typedTriage').TriageRunOptions)=>Promise<import('../lib/typedTriage').TriageRunSummary>}) {
  const prefs=typedTriageSettings(store)
  const selection=`${prefs.provider}:${prefs.localModel}`
  const selectionRef=useRef(selection);selectionRef.current=selection
  const local=prefs.provider==='local'
  const threshold=local?prefs.localConfidence:prefs.confidence
  const [confidenceText,setConfidenceText]=useState(String(threshold))
  useEffect(()=>{setConfidenceText(String(threshold))},[threshold,local])
  const validConfidence=confidenceText.trim()!=='' && Number(confidenceText)>=0.5 && Number(confidenceText)<=1
  const [running,setRunning]=useState(false)
  const [runMessage,setRunMessage]=useState('')
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[limit,setLimit]=useState(25)
  const candidates=triageCandidates(store,{from,to,limit})
  const rangeError=from && to && from>to ? 'From must be on or before Through.' : !Number.isInteger(limit)||limit<1||limit>1000 ? 'Maximum messages must be between 1 and 1,000.' : ''
  useEffect(()=>{setRunMessage('')},[from,to,limit,threshold])
  async function runPending(reclassify=true){
    if(rangeError || !validConfidence)return
    setRunning(true);setRunMessage('Checking pending mail…')
    try{const result=await onRunTriage(reclassify?candidates:undefined,{reclassify});setRunMessage(`${result.completed} messages classified.${result.stopReason ? ` Stopped: ${result.stopReason.replaceAll('-', ' ')}.` : result.completed===0 ? (reclassify?' No eligible messages were classified; previously dismissed or manually judged messages are protected.':' No eligible unprocessed messages from the last 24 hours.') : (prefs.mode==='shadow'?' Results saved privately in Shadow mode.':' Only results meeting your confidence threshold appear as suggestions.')}`)}
    catch{setRunMessage('Triage could not finish. Check the connection and refresh the status for details.')}
    finally{setRunning(false);await refresh()}
  }
  const [testing,setTesting]=useState(false)
  const [testMessage,setTestMessage]=useState('')
  const [status,setStatus]=useState<TypedJudgmentStatus|null>(null),[error,setError]=useState('')
  const [comparison,setComparison]=useState({sampled:0,compared:0,agree:0})
  async function refresh(){try{const [s,f]=await Promise.all([getTypedJudgmentStatus(),readTriageFile()]);setStatus(s);setComparison(shadowComparison(f));setError('')}catch{setError('Judgment bridge unavailable. Automatic triage remains inactive.')}}
  useEffect(()=>{void refresh()},[])
  async function testConnection() {
    setTesting(true);setTestMessage('Testing with a synthetic message…')
    const selected=selection
    try {const result=await testTypedTriageConnection(prefs.dailyCap,prefs.provider,prefs.localModel);if(selectionRef.current===selected)setTestMessage(connectionTestMessage(result))}
    catch {if(selectionRef.current===selected)setTestMessage('Test failed: the judgment bridge could not complete the request.')}
    finally {setTesting(false);await refresh()}
  }
  useEffect(()=>{setTestMessage('')},[selection])
  function patch(update:Partial<NonNullable<MailStore['settings']['typedTriage']>>) {setStore(current=>({...current,settings:{...current.settings,typedTriage:{...typedTriageSettings(current),...update}}}))}
  return <SettingsCard id="settings-typed-triage">
    <Subject>Automatic triage</Subject>
    <Meta>{local?'Uses the selected model in your local Ollama runtime. No fallback to an online provider.':'Sends recent incoming mail excerpts and sender details to TypeSafe. Add its key in desktop Settings → API keys.'} Bulk mail is skipped. No mail is moved or sent.</Meta>
    <SelectField aria-label="Triage provider" value={prefs.provider} options={[{value:'typesafe',label:'TypeSafe'},{value:'local',label:'Local model (Ollama)'}]} onValueChange={provider=>patch({provider:provider as 'typesafe'|'local'})}/>
    {local && <><SelectField aria-label="Local triage model" value={prefs.localModel} options={[{value:'',label:'Choose an installed model'},...(status?.local?.models??[]).map(value=>({value,label:value}))]} onValueChange={localModel=>patch({localModel})}/><Meta>Local confidence is self-reported and is not calibrated like a classifier score. Evaluate in Shadow mode before enabling suggestions.</Meta></>}
    <SettingsFullRow>
      <SelectField aria-label="Automatic triage mode" value={prefs.mode} options={[{value:'off',label:'Off'},{value:'shadow',label:'Shadow trial — store results privately'},{value:'suggest',label:'Show confident suggestions'}]} onValueChange={mode=>patch({mode:mode as 'off'|'shadow'|'suggest'})}/>
      <label>Maximum requests per day <input aria-label="Triage daily cap" type="number" min={1} max={1000} value={prefs.dailyCap} onChange={e=>{const dailyCap=Number(e.target.value);if(Number.isInteger(dailyCap)&&dailyCap>=1&&dailyCap<=1000)patch({dailyCap})}}/></label>
      <label>{local?'Minimum self-reported confidence':'Minimum confidence'} <input aria-label="Triage confidence" type="number" min={0.5} max={1} step={0.05} value={confidenceText} aria-invalid={!validConfidence} onChange={e=>{const value=e.target.value;setConfidenceText(value);const confidence=Number(value);if(value.trim()!==''&&confidence>=0.5&&confidence<=1)patch(local?{localConfidence:confidence}:{confidence})}}/></label>
    </SettingsFullRow>
    {!validConfidence && <Meta role="alert">Enter a confidence between 0.5 and 1. Preferences save automatically when valid.</Meta>}
    <Meta>{status ? `${local?(status.local?.available?(prefs.localModel && status.local.models.includes(prefs.localModel)?'Local model selected':'Select an installed local model'):'Local runtime unavailable'):(status.configured?'TypeSafe key saved':'TypeSafe not configured')} · ${status.today} requests attempted today` : 'Checking bridge…'}. Low-confidence results stay with the drawer. Failed attempts count toward the cap.</Meta>
    <Meta>{comparison.sampled} shadow results · {comparison.compared} compared with human/drawer judgments · {comparison.agree} agree. Shadow results never appear as inbox verdicts.</Meta>
    <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
      <Button size="sm" disabled={testing || (local?!(status?.local?.available && status.local.models.includes(prefs.localModel)):!status?.configured)} onClick={()=>void testConnection()}>{testing?'Testing…':'Test connection'}</Button>
      <Button size="sm" disabled={testing || running} onClick={()=>void refresh()}>Refresh status</Button>
      <Button size="sm" disabled={testing || running || prefs.mode==='off' || !!rangeError || !validConfidence || !candidates.length} onClick={()=>void runPending(true)}>{running?'Running triage…':'Run triage now'}</Button>
    </div>
    <details>
      <summary>Reclassify existing mail…</summary>
      <Meta>Use your current provider, mode and confidence preferences. Select a date range, a maximum count, or both. Newest incoming message per conversation; bulk mail and human/drawer judgments are protected. This makes fresh requests and counts toward your daily cap.</Meta>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        <label>From <input aria-label="Reclassify from date" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label>Through <input aria-label="Reclassify through date" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <label>Maximum messages <input aria-label="Reclassify maximum messages" type="number" min={1} max={1000} value={limit} onChange={e=>setLimit(Number(e.target.value))}/></label>
      </div>
      {rangeError && <Meta role="alert">{rangeError}</Meta>}
      <Meta>{candidates.length} candidate messages. Dismissed messages are skipped; processing stops at the daily cap.</Meta>
      <Button size="sm" disabled={testing || running || prefs.mode==='off' || !!rangeError || !validConfidence || !candidates.length} onClick={()=>void runPending(true)}>{running?'Running triage…':`Reclassify up to ${candidates.length} messages`}</Button>
    </details>
    <Meta>Refresh status reloads counters only. Run triage now reclassifies the candidate messages using the date range and count above (newest 25 by default), including previous model results. Automatic background triage only checks unprocessed recent mail. Both respect your daily cap.</Meta>
    {runMessage && <Meta role="status" aria-live="polite">{runMessage}</Meta>}
    <Meta>Tests use a synthetic message, never your mail, and count as one request toward the daily limit.</Meta>
    <Meta role="status" aria-live="polite">{testMessage || (local?'Select an installed model, then test the local connection.':status?.configured ? 'Key saved; connection not tested in this session.' : 'Add a TypeSafe API key to enable connection testing.')}</Meta>
    {error && <p role="alert">{error}</p>}
    {status && status.recent.length>0 && <details><summary>Recent requests</summary>
      <ul>{status.recent.map(item=><li key={item.id}>{new Date(item.at).toLocaleTimeString()} · {item.status} · {item.latencyMs??'—'} ms · {item.inputTokens??'—'} input / {item.outputTokens??'—'} output tokens</li>)}</ul>
      <Meta>Provider currency cost is unavailable; token usage is shown without an invented price.</Meta>
    </details>}
  </SettingsCard>
}
