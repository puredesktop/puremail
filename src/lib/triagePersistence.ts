import { readPlatformStorageJson, writePlatformStorageJson } from '../bridge/platformBridge'
import type { MailAiTriageRecord, MailStore } from '../types'
export interface TriageFile { version:1; dismissed?:string[]; records:MailAiTriageRecord[]; shadow:MailAiTriageRecord[] }
const storage={appSlug:'mail',fileName:'mail-triage.json'}
export async function readTriageFile():Promise<TriageFile> {
  const {value}=await readPlatformStorageJson(storage)
  if (value == null) return {version:1,records:[],shadow:[]}
  const file=value as TriageFile
  if(file.version!==1 || !Array.isArray(file.records) || !Array.isArray(file.shadow)) throw Error('Mail triage file is invalid')
  return file
}
/** One origin-wide lock across Mail tabs. Always read disk inside the lock;
 * a stale mailbox snapshot must never replace another window's decisions. */
export async function updateTriageFile<T>(fn:(file:TriageFile)=>{file:TriageFile;result:T}|Promise<{file:TriageFile;result:T}>):Promise<T> {
  if (!navigator.locks) throw Error('Safe triage storage is unavailable')
  return navigator.locks.request('puremail:triage-file',async()=>{
    const {file,result}=await fn(await readTriageFile())
    await writePlatformStorageJson({...storage,value:file})
    return result
  })
}
export async function withStoredTriage(store:MailStore):Promise<MailStore> {
  return {...store,aiTriage:(await readTriageFile()).records}
}
