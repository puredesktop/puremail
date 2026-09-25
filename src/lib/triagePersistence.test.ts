// @vitest-environment happy-dom
import {it,expect,vi,beforeEach} from 'vitest'
import {updateTriageFile,withStoredTriage} from './triagePersistence'
import {aiTriageFixture} from './aiTriageFixture'
import {applyAiTriage} from './aiTriage'
let disk:unknown=null
vi.mock('../bridge/platformBridge',()=>({readPlatformStorageJson:async()=>({value:structuredClone(disk)}),writePlatformStorageJson:async({value}:{value:unknown})=>{disk=structuredClone(value)}}))
beforeEach(()=>{disk=null;let tail=Promise.resolve();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,fn:()=>Promise<void>)=>{const next=tail.then(fn);tail=next.catch(()=>{});return next}}})})
it('merges independent decisions from stale Mail windows without losing either, and re-reads before answering',async()=>{
 const s=aiTriageFixture(new Date()).store
 await Promise.all(['t_ask','t_cc'].map(id=>updateTriageFile(file=>{
  const next=applyAiTriage({...s,aiTriage:file.records},[{id,verdict:'fyi'}],{decidedBy:'user',now:new Date()})
  return {file:{...file,records:next.store.aiTriage!},result:null}
 })))
 expect((await withStoredTriage(s)).aiTriage?.map(r=>r.threadId).sort()).toEqual(['t_ask','t_cc'])
})
it('does not replace corrupt storage with empty verdicts',async()=>{disk={broken:true};await expect(updateTriageFile(file=>({file,result:null}))).rejects.toThrow('invalid');expect(disk).toEqual({broken:true})})
