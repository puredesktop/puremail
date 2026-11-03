import { readPlatformStorageJson, writePlatformStorageJson } from '../bridge/platformBridge'
import type { MailAiTriageRecord, MailStore } from '../types'
export interface TriageFile { version:1; dismissed?:string[]; records:MailAiTriageRecord[]; shadow:MailAiTriageRecord[] }
const storage={appSlug:'mail',fileName:'mail-triage.json'}
function parseTriageFile(value:unknown):TriageFile {
  if (value == null) return {version:1,records:[],shadow:[]}
  const file=value as TriageFile
  if(file.version!==1 || !Array.isArray(file.records) || !Array.isArray(file.shadow)) throw Error('Mail triage file is invalid')
  return file
}
export async function readTriageFile():Promise<TriageFile> {
  return parseTriageFile((await readPlatformStorageJson(storage)).value)
}
/** One origin-wide lock across Mail tabs. Always read disk inside the lock;
 * a stale mailbox snapshot must never replace another window's decisions. A
 * frame nested in another app's may not share that lock, so the write is also
 * conditional: a copy saving in between makes the change run again on what it saved. */
export async function updateTriageFile<T>(fn:(file:TriageFile)=>{file:TriageFile;result:T}|Promise<{file:TriageFile;result:T}>):Promise<T> {
  if (!navigator.locks) throw Error('Safe triage storage is unavailable')
  return navigator.locks.request('puremail:triage-file',async()=>{
    for(let attempt=0;attempt<5;attempt++){
      const read=await readPlatformStorageJson(storage)
      const {file,result}=await fn(parseTriageFile(read.value))
      const written=await writePlatformStorageJson({...storage,value:file,...(read.version!==undefined?{ifMatch:read.version}:{})})
      if(!written.conflict)return result
    }
    throw Error('Other copies of Mail kept saving triage at the same moment.')
  })
}
export async function withStoredTriage(store:MailStore):Promise<MailStore> {
  return {...store,aiTriage:(await readTriageFile()).records}
}
