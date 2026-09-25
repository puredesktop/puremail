import {describe,it,expect} from 'vitest'
import {mailSettingsPatch} from './mailSettingsPatch'
import {aiTriageFixture} from './aiTriageFixture'
describe('Mail settings persistence patches',()=>{
 it('does not overwrite saved settings merely by opening a window',()=>{const s=aiTriageFixture(new Date()).store.settings;expect(mailSettingsPatch(s,{...s})).toEqual({})})
 it('persists confidence edits without replaying unrelated stale settings',()=>{const s=aiTriageFixture(new Date()).store.settings;const prior={...s,typedTriage:{mode:'suggest' as const,confidence:0.9,dailyCap:100}};const next={...prior,typedTriage:{...prior.typedTriage,confidence:0.7}};expect(mailSettingsPatch(prior,next)).toEqual({typedTriage:next.typedTriage})})
})
