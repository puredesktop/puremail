import {describe,it,expect,vi} from 'vitest'
import {aiTriageFixture} from './aiTriageFixture'
import {applyAiTriage,cleanTriageExcerpt} from './aiTriage'
import {aiTriageCurrent} from './aiTriageState'
import {mergeMailProviderSyncResult} from './mailModel'
import {acceptedTypedVerdict,createTypedTriageRunner,triageCandidates,type TriageRunnerDeps} from './typedTriage'
import type {TriageFile} from './triagePersistence'
import type {TypedJudgmentResult} from '@purescience/platform-ui/bridge/typedJudgments.mjs'
const now=new Date('2026-09-17T12:00:00Z')
const result:TypedJudgmentResult={status:'completed',model:'jev-test',latencyMs:120,usage:{input_tokens:50,output_tokens:15},answers:{verdict:{type:'choice',choice:'needs_reply',confidence:0.96,probabilities:{needs_reply:0.97,important:0.01,fyi:0.01,noise:0.01}},credentials:{type:'noul',noul:0.01},domainConflict:{type:'noul',noul:0.01},reward:{type:'noul',noul:0.01}}}
function harness(mode:'off'|'shadow'|'suggest'='suggest') {
 const fixture=aiTriageFixture(now);let store=fixture.store
 store.settings={...store.settings,typedTriage:{mode,dailyCap:10,confidence:0.9}}
 let file:TriageFile={version:1,records:[],shadow:[]}
 const evaluate=vi.fn(async(_request: import('@purescience/platform-ui/bridge/typedJudgments.mjs').TypedJudgmentRequest)=>result)
 const deps:TriageRunnerDeps={evaluate,now:()=>now.getTime(),read:async()=>file,update:async(fn)=>{const next=await fn(file);file=next.file;return next.result}}
 const run=createTypedTriageRunner(()=>store,records=>{store={...store,aiTriage:records}},deps)
 return {fixture,run,evaluate,getStore:()=>store,setStore:(s:typeof store)=>{store=s},file:()=>file,setFile:(f:TriageFile)=>{file=f}}
}
describe('TypeSafe Mail trial',()=>{
 it('is off by default and skips bulk/outgoing messages',async()=>{const h=harness('off');await h.run(['t_ask']);expect(h.evaluate).not.toHaveBeenCalled();const live=harness();await live.run(['t_news','t_mine']);expect(live.evaluate).not.toHaveBeenCalled()})
 it('stores shadow results without altering the inbox or drawer queue',async()=>{const h=harness('shadow');await h.run(['t_ask']);expect(h.file().shadow).toHaveLength(1);expect(h.file().records).toHaveLength(0);expect(aiTriageCurrent(h.getStore(),{id:'t_ask'})).toBeNull()})
 it('publishes confident results and lets a new delivered message reopen a thread',async()=>{const h=harness();await h.run(['t_ask']);expect(h.file().records[0]).toMatchObject({verdict:'needs_reply',decidedBy:'model',confidence:0.96});const s=h.getStore();s.messages=[...s.messages,{...s.messages[0],id:'new-message',threadId:'t_ask',receivedAt:new Date(now.getTime()+1000).toISOString()}];expect(aiTriageCurrent({...s},{id:'t_ask'})).toBeNull()})
 it('does not turn low confidence or suspicion into a verdict',async()=>{const h=harness();h.evaluate.mockResolvedValue({...result,answers:{...result.answers,credentials:{type:'noul',noul:0.8}}} as TypedJudgmentResult);await h.run(['t_ask']);expect(h.file().records).toHaveLength(0);expect(h.file().shadow).toHaveLength(1);expect(acceptedTypedVerdict(result,0.99)).toBeNull()})
 it('preserves a human correction made while the request is in flight',async()=>{const h=harness();h.evaluate.mockImplementation(async()=>{const corrected=applyAiTriage(h.getStore(),[{id:'t_ask',verdict:'fyi'}],{decidedBy:'user',now});h.setFile({...h.file(),records:corrected.store.aiTriage!});return result});await h.run(['t_ask']);expect(h.file().records[0]).toMatchObject({verdict:'fyi',decidedBy:'user'})})
 it('preserves drawer judgments and records corrections from model suggestions',()=>{const h=harness();const s=h.getStore();const at=s.messages.find(m=>m.threadId==='t_ask')!.receivedAt;const model=applyAiTriage(s,[{id:'t_ask',at,verdict:'noise',reason:'test'}],{decidedBy:'model',confidence:0.95,now}).store;const human=applyAiTriage(model,[{id:'t_ask',verdict:'important'}],{decidedBy:'user',now}).store;expect(human.aiTriage![0].correctedFrom).toBe('noise');expect(mergeMailProviderSyncResult(human,s).aiTriage).toEqual(human.aiTriage)})
 it('does not publish after the user disables the trial during HTTP',async()=>{const h=harness();h.evaluate.mockImplementation(async()=>{h.setStore({...h.getStore(),settings:{...h.getStore().settings,typedTriage:{mode:'off',dailyCap:10,confidence:0.9}}});return result});await h.run(['t_ask']);expect(h.file().records).toHaveLength(0)})
 it('does not publish a response against a superseded message',async()=>{const h=harness();h.evaluate.mockImplementation(async()=>{const s=h.getStore();h.setStore({...s,messages:[...s.messages,{...s.messages[0],id:'new',threadId:'t_ask',receivedAt:new Date(now.getTime()+1000).toISOString()}]});return result});await h.run(['t_ask']);expect(h.file().records).toHaveLength(0)})
 it('leaves unavailable requests for the drawer and avoids a burst of retries',async()=>{const h=harness();h.evaluate.mockResolvedValue({status:'skipped',reason:'unavailable'});await h.run(['t_ask','t_cc']);expect(h.evaluate).toHaveBeenCalledTimes(1);expect(h.file().records).toHaveLength(0)})
 it('cleans padding and tracking URLs',()=>{expect(cleanTriageExcerpt('Hi\u034f\u200b [https://track.example/x] see https://example.com/a?tracking=1')).toBe('Hi see [link]')})
 it('routes local triage to the selected model with its own threshold',async()=>{const h=harness();h.setStore({...h.getStore(),settings:{...h.getStore().settings,typedTriage:{mode:'suggest',dailyCap:10,confidence:0.9,provider:'local',localModel:'fixture',localConfidence:0.99}}});h.evaluate.mockResolvedValue({...result,provider:'local',model:'fixture'});await h.run(['t_ask']);expect(h.evaluate.mock.calls[0][0]).toMatchObject({provider:'local',localModel:'fixture'});expect(h.file().records).toHaveLength(0);expect(h.file().shadow[0]).toMatchObject({provider:'local',model:'fixture'})})
 it('discards an in-flight result after changing providers',async()=>{const h=harness();h.evaluate.mockImplementation(async()=>{h.setStore({...h.getStore(),settings:{...h.getStore().settings,typedTriage:{mode:'suggest',dailyCap:10,confidence:0.9,provider:'local',localModel:'fixture'}}});return result});await h.run(['t_ask']);expect(h.file().records).toHaveLength(0);expect(h.file().shadow).toHaveLength(0)})

})

describe('manual triage runs',()=>{
 it('reports completed work and leaves ordinary repeat runs deduplicated',async()=>{const h=harness();expect(await h.run(['t_ask'])).toEqual({completed:1});expect(await h.run(['t_ask'])).toEqual({completed:0});expect(h.evaluate).toHaveBeenCalledTimes(1)})
 it('reclassifies a model result with a distinct explicit run identity',async()=>{const h=harness();await h.run(['t_ask']);await h.run(['t_ask'],{reclassify:true});expect(h.evaluate).toHaveBeenCalledTimes(2);expect(h.evaluate.mock.calls[1][0].state).toHaveProperty('classificationRun')})
 it('removes the old model suggestion when new preferences reject it',async()=>{const h=harness();await h.run(['t_ask']);const s=h.getStore();h.setStore({...s,settings:{...s.settings,typedTriage:{mode:'suggest',dailyCap:10,confidence:1}}});await h.run(['t_ask'],{reclassify:true});expect(h.file().records).toHaveLength(0);expect(h.file().shadow).toHaveLength(1)})
 it('keeps explicit reclassification behind human and dismissal protections',async()=>{const h=harness();await h.run(['t_ask']);const f=h.file();h.setFile({...f,records:f.records.map(r=>({...r,decidedBy:'user'}))});await h.run(['t_ask'],{reclassify:true});expect(h.evaluate).toHaveBeenCalledTimes(1);h.setFile({...f,records:[],dismissed:[f.records[0].messageId]});await h.run(['t_ask'],{reclassify:true});expect(h.evaluate).toHaveBeenCalledTimes(1)})
 it('reports daily-cap stops without pretending to classify',async()=>{const h=harness();h.evaluate.mockResolvedValue({status:'skipped',reason:'daily-cap'});expect(await h.run(['t_ask'],{reclassify:true})).toEqual({completed:0,stopReason:'daily-cap'})})
 it('selects by local date range and count, excluding bulk/outgoing mail',()=>{const h=harness();expect(triageCandidates(h.getStore(),{limit:1})).toHaveLength(1);const ids=triageCandidates(h.getStore(),{limit:100,from:'2026-09-17',to:'2026-09-17'});expect(ids).toContain('t_ask');expect(ids).not.toContain('t_news');expect(ids).not.toContain('t_mine');expect(triageCandidates(h.getStore(),{limit:100,from:'2026-09-18',to:'2026-09-17'})).toEqual([])})
 it('only explicit reclassification includes mail older than 24 hours',async()=>{const h=harness();const s=h.getStore();h.setStore({...s,messages:s.messages.map(m=>({...m,receivedAt:'2026-09-01T10:00:00Z'}))});await h.run(['t_ask']);expect(h.evaluate).not.toHaveBeenCalled();await h.run(['t_ask'],{reclassify:true});expect(h.evaluate).toHaveBeenCalledTimes(1)})
})
