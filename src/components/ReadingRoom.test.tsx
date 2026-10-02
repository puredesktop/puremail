// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {ReadingRoom} from './ReadingRoom'
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
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(document.querySelector('[aria-label="Reading room"]')?.getAttribute('data-expanded')).toBe('false')
  expect(onBack).toHaveBeenCalledTimes(1)
  const slider=document.querySelector<HTMLInputElement>('input[aria-label="Reading text size"]')!
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'24');slider.dispatchEvent(new Event('input',{bubbles:true}))})
  expect(document.querySelector('output')?.textContent).toBe('24px')
  await act(async()=>button('General note').click())
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
  expect(document.activeElement?.id).toBe('reading-room-whole-note')
  expect(scroll).toHaveBeenCalled()
  expect(document.querySelector('.tiptap')?.textContent).toContain('A long sentence continues on another source line.')
  expect(document.querySelector('aside[aria-label="Notes"]')).toBeNull()
 }finally{await act(async()=>root.unmount());host.remove()}
})
