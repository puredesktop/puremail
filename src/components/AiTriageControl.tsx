import { useRef, useState } from 'react'
import { SelectField } from '@purescience/platform-ui/components/common/inputs/SelectField'
import { applyAiTriage } from '../lib/aiTriage'
import { AI_TRIAGE_LABELS, AI_TRIAGE_VERDICTS, aiTriageCurrent, isAiTriageVerdict, latestDeliveredMessage } from '../lib/aiTriageState'
import { updateTriageFile } from '../lib/triagePersistence'
import type { MailStore, MailThread } from '../types'
export function AiTriageControl({store,setStore,thread}:{store:MailStore;setStore:React.Dispatch<React.SetStateAction<MailStore>>;thread:MailThread}):React.ReactElement {
  const storeRef=useRef(store)
  storeRef.current=store
  const current=aiTriageCurrent(store,thread)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  async function change(value:string) {
    setBusy(true);setError('')
    try {
      const records=await updateTriageFile(file=>{
        const latest=latestDeliveredMessage(storeRef.current,thread.id)
        if(value==='')return {file:{...file,records:file.records.filter(r=>r.threadId!==thread.id),dismissed:[...(file.dismissed??[]),...(latest?[latest.id]:[])].slice(-3000)},result:file.records.filter(r=>r.threadId!==thread.id)}
        if(!isAiTriageVerdict(value))throw Error('Invalid verdict')
        const records=applyAiTriage({...storeRef.current,aiTriage:file.records},[{id:thread.id,verdict:value}],{decidedBy:'user',now:new Date()}).store.aiTriage ?? []
        return {file:{...file,records},result:records}
      })
      setStore(s=>({...s,aiTriage:records}))
    } catch(e) {setError(e instanceof Error?e.message:'Could not save triage correction')}
    finally {setBusy(false)}
  }
  return <div>
    <SelectField variant="compact" aria-label="Triage verdict" value={current?.verdict??''} disabled={busy}
      options={[{value:'',label:current?'Clear triage':'Not triaged'},...AI_TRIAGE_VERDICTS.map(value=>({value,label:AI_TRIAGE_LABELS[value]}))]}
      onValueChange={value=>void change(value)} />
    {current && <small title={current.reason}>{current.decidedBy==='user'?'Set by you':current.decidedBy==='model'?`${current.provider==='local'?'Local model suggestion':'TypeSafe suggestion'} · ${Math.round((current.confidence??0)*100)}% ${current.provider==='local'?'self-reported confidence':'confidence'}`:'Drawer judgment'}</small>}
    {error && <span role="alert">{error}</span>}
  </div>
}
