// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {ReadingRoom} from './ReadingRoom'
import type { MessageIdentity } from '../lib/readingRoom'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
it('expands and restores the reader and focuses the whole-message note',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const onBack=vi.fn();const scroll=vi.fn();HTMLElement.prototype.scrollIntoView=scroll
 try{
  await act(async()=>root.render(<ReadingRoom message={null} identity={{messageId:'m',article:'A long sentence\ncontinues on another source line.',subject:'A message',from:{name:'Sender',email:'sender@example.test'},date:'2026-10-02T00:00:00Z'} as never} room={{file:{byMessageId:{}},error:null} as never} onBack={onBack} onDraftReply={vi.fn()} onWriteSummary={vi.fn()}/>))
  const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!
  expect(document.querySelector('[aria-label="Reading room"]')?.getAttribute('data-expanded')).toBe('true')
  expect(document.querySelector('[aria-label="Reading room"]')?.parentElement).toBe(document.body)
  await act(async()=>button('Restore').click())
  expect(document.querySelector('[aria-label="Reading room"]')?.getAttribute('data-expanded')).toBe('false')
  await act(async()=>button('Expand').click())
  expect(document.querySelector('[aria-label="Reading room"]')?.getAttribute('data-expanded')).toBe('true')
  const annotationInput = document.querySelector('.tiptap')!
  const stopEscape = (event: Event) => event.stopPropagation()
  annotationInput.addEventListener('keydown', stopEscape)
  const escape = new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})
  await act(async()=>annotationInput.dispatchEvent(escape))
  expect(escape.defaultPrevented).toBe(true)
  annotationInput.removeEventListener('keydown', stopEscape)
  expect(document.querySelector('[aria-label="Reading room"]')?.getAttribute('data-expanded')).toBe('false')
  expect(onBack).toHaveBeenCalledTimes(1)
  const slider=document.querySelector<HTMLInputElement>('input[aria-label="Reading text size"]')!
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'24');slider.dispatchEvent(new Event('input',{bubbles:true}))})
  expect(document.querySelector('output')?.textContent).toBe('24px')
  await act(async()=>button('General note').click())
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
  expect(document.activeElement?.id).toBe('reading-room-whole-note')
  expect(scroll).toHaveBeenCalled()
  expect((document.querySelector('.tiptap') as HTMLElement & { editor: { getText: () => string } }).editor.getText()).toBe('A long sentence\ncontinues on another source line.')
  expect(document.querySelector('aside[aria-label="Notes"]')).toBeNull()
 }finally{await act(async()=>root.unmount());host.remove()}
})

const identity: MessageIdentity = { messageId: 'reply-test', threadId: 'thread-test', article: 'A message to annotate.', subject: 'Planning', from: { name: 'Sender', email: 'sender@example.test' }, receivedAt: '2026-10-02T00:00:00Z' }
async function replyFixture() {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
 const room = { file: { version: 1, byMessageId: {} }, error: null, setReplyIntent: vi.fn().mockResolvedValue(undefined) }
 const back = vi.fn(), draft = vi.fn()
 const render = async () => { await act(async () => root.render(<ReadingRoom message={null} identity={identity} room={room as never} onBack={back} onDraftReply={draft} onWriteSummary={vi.fn()} />)) }
 await render()
 const input = () => document.querySelector<HTMLTextAreaElement>('#reading-room-intent')!
 const type = async (text: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), text); input().dispatchEvent(new Event('input', { bubbles: true })) }) }
 const click = async () => { await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Draft the reply')!.click()) }
 const cleanup = async () => { await act(async () => root.unmount()); host.remove() }
 return { room, back, draft, render, input, type, click, cleanup }
}
it('saves reply intent before requesting a draft and keeps the text after failure', async () => {
 const f = await replyFixture()
 try {
  await f.type('Please propose next Tuesday.')
  f.room.setReplyIntent.mockRejectedValueOnce(new Error('Could not save reply'))
  await f.click()
  expect(f.draft).not.toHaveBeenCalled()
  expect(f.input().value).toBe('Please propose next Tuesday.')
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Could not save reply')
  let finish!: () => void
  f.room.setReplyIntent.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
  await f.click()
  expect(f.draft).not.toHaveBeenCalled()
  await act(async () => finish())
  expect(f.draft).toHaveBeenCalledWith(expect.objectContaining({ replyIntent: 'Please propose next Tuesday.', threadId: 'thread-test' }))
  expect(document.querySelector('aside[aria-label="Notes"]')).toBeNull()
 } finally { await f.cleanup() }
})
it('saves focused reply text on Escape before returning to mail', async () => {
 const f = await replyFixture()
 try {
  await f.type('Thanks for the update.')
  let finish!: () => void
  f.room.setReplyIntent.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
  await act(async () => f.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(f.back).not.toHaveBeenCalled()
  expect(f.room.setReplyIntent).toHaveBeenCalledWith(identity, 'Thanks for the update.')
  await act(async () => finish())
  expect(f.back).toHaveBeenCalledTimes(1)
 } finally { await f.cleanup() }
})
it('waits for an optimistic blur save before drafting and reports its failure', async () => {
 const f = await replyFixture()
 try {
  await f.type('Words still being saved')
  let fail!: (error: Error) => void
  f.room.setReplyIntent.mockReturnValueOnce(new Promise<void>((_, reject) => { fail = reject }))
  await act(async () => f.input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  Object.assign(f.room.file.byMessageId, { [identity.messageId]: { ...identity, notes: [], replyIntent: 'Words still being saved', updatedAt: '2026-10-02' } })
  await f.render()
  await f.click()
  expect(f.room.setReplyIntent).toHaveBeenCalledTimes(1)
  expect(f.draft).not.toHaveBeenCalled()
  await act(async () => fail(new Error('Disk unavailable')))
  expect(f.draft).not.toHaveBeenCalled()
  expect(f.input().value).toBe('Words still being saved')
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Disk unavailable')
  await f.click()
  expect(f.draft).toHaveBeenCalledTimes(1)
 } finally { await f.cleanup() }
})
it('adopts loaded reply intent while retaining newer local typing', async () => {
 const f = await replyFixture()
 try {
  Object.assign(f.room.file.byMessageId, { [identity.messageId]: { ...identity, notes: [], replyIntent: 'Saved earlier', updatedAt: '2026-10-02' } })
  await f.render()
  expect(f.input().value).toBe('Saved earlier')
  await f.type('New local words')
  Object.assign(f.room.file.byMessageId, { [identity.messageId]: { ...identity, notes: [], replyIntent: 'An older acknowledgement', updatedAt: '2026-10-02' } })
  await f.render()
  expect(f.input().value).toBe('New local words')
 } finally { await f.cleanup() }
})
it('serializes edits made while an earlier reply save is pending', async () => {
 const f = await replyFixture()
 try {
  let first!: () => void, second!: () => void
  f.room.setReplyIntent.mockReturnValueOnce(new Promise<void>(resolve => { first = resolve }))
  f.room.setReplyIntent.mockReturnValueOnce(new Promise<void>(resolve => { second = resolve }))
  await f.type('Earlier words')
  await act(async () => f.input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  await f.type('Newer words')
  await act(async () => f.input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  await f.click()
  expect(f.room.setReplyIntent).toHaveBeenCalledTimes(1)
  await act(async () => first())
  expect(f.room.setReplyIntent).toHaveBeenLastCalledWith(identity, 'Newer words')
  expect(f.draft).not.toHaveBeenCalled()
  await act(async () => second())
  expect(f.room.setReplyIntent).toHaveBeenCalledTimes(2)
  expect(f.draft).toHaveBeenCalledWith(expect.objectContaining({ replyIntent: 'Newer words' }))
 } finally { await f.cleanup() }
})
