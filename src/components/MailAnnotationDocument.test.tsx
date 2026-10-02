// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {Editor} from '@tiptap/core'
import {buildExtensions} from '@purescience/platform-ui/editor'
import {expect,it,vi} from 'vitest'
import {MailAnnotationDocument,MailSourceLock} from './MailAnnotationDocument'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
it('allows annotations but rejects edits to source text and paragraphs',()=>{
 const element=document.createElement('div');document.body.append(element)
 const editor=new Editor({element,content:'<p>Original message text.</p>',extensions:[...buildExtensions({features:{comments:true}}),MailSourceLock]})
 try{
  editor.commands.insertContentAt(2,'changed');expect(editor.getText()).toBe('Original message text.')
  editor.commands.setTextSelection({from:1,to:9});editor.commands.setCommentMark({commentId:'n',commentText:'A useful note'})
  expect(editor.getHTML()).toContain('data-comment-id="n"')
  editor.commands.setTextSelection(4);editor.commands.splitBlock();expect(editor.getJSON().content).toHaveLength(1)
 }finally{editor.destroy();element.remove()}
})
it('keeps private notes out of the visible document without removing stored notes',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),removeNote=vi.fn()
 const privateNote={id:'private',kind:'private',quote:'Original',text:'Private thought',start:0,end:8,createdAt:'2026-10-02T00:00:00Z'}
 try{
  await act(async()=>root.render(<MailAnnotationDocument source="Original message text." identity={{messageId:'m'} as never} room={{file:{byMessageId:{m:{notes:[privateNote]}}},removeNote} as never} showPrivate={false} noteKind="reply"/>))
  expect(host.innerHTML).not.toContain('Private thought');expect(removeNote).not.toHaveBeenCalled()
 }finally{await act(async()=>root.unmount());host.remove()}
})
it('persists plugin comments with original source offsets and selected privacy',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),addNote=vi.fn(),updateNote=vi.fn(),removeNote=vi.fn()
 try{
  await act(async()=>root.render(<MailAnnotationDocument source={'Original\nmessage text.'} identity={{messageId:'m'} as never} room={{file:{byMessageId:{}},addNote,updateNote,removeNote} as never} showPrivate noteKind="private"/>))
  const editor=(host.querySelector('.tiptap') as HTMLElement&{editor:Editor}).editor
  await act(async()=>{editor.commands.setTextSelection({from:1,to:17});editor.commands.setCommentMark({commentId:'new',commentText:'Keep this private'})})
  expect(addNote).toHaveBeenCalledWith({messageId:'m'},expect.objectContaining({id:'new',kind:'private',quote:'Original\nmessage',start:0,end:16,text:'Keep this private'}))
  expect(editor.getText()).toBe('Original message text.')
 }finally{await act(async()=>root.unmount());host.remove()}
})
