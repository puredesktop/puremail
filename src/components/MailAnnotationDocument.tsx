import {useMemo} from 'react'
import {Extension,type JSONContent} from '@tiptap/core'
import {Plugin} from '@tiptap/pm/state'
import {DocumentEditor,buildExtensions} from '@purescience/platform-ui/editor'
import {articleOf,paragraphPieces,resolveNote,type MessageIdentity,type NoteKind} from '../lib/readingRoom'
import type {ReadingRoomStore} from '../hooks/useReadingRoom'
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
/** Annotation transactions can change marks, never the source message or its structure. */
export const MailSourceLock=Extension.create({name:'mailSourceLock',addProseMirrorPlugins(){return [new Plugin({filterTransaction(tr,state){
 if(!tr.docChanged)return true
 const plain=(node:JSONContent):JSONContent=>{
  const {marks:_marks,content,...rest}=node
  if(!content)return rest
  const result:JSONContent[]=[]
  for(const child of content.map(plain)){
   const last=result.at(-1)
   if(last?.type==='text'&&child.type==='text')last.text=(last.text??'')+(child.text??'')
   else result.push(child)
  }
  return {...rest,content:result}
 }
 const source=(doc:typeof state.doc)=>JSON.stringify(plain(doc.toJSON()))
 return source(tr.doc)===source(state.doc)
}})]}})
export function MailAnnotationDocument({source,identity,room,showPrivate,noteKind}:{source:string;identity:MessageIdentity;room:ReadingRoomStore;showPrivate:boolean;noteKind:NoteKind}){
 const article=useMemo(()=>articleOf(source),[source])
 const notes=room.file.byMessageId[identity.messageId]?.notes??[]
 const visible=notes.filter(n=>n.quote&&(showPrivate||n.kind!=='private'))
 const value=useMemo(()=>{
  const marks=visible.flatMap(n=>{const at=resolveNote(article.text,n);return at?[{id:n.id,kind:n.kind,...at}]:[]})
  return article.paragraphs.map(p=>`<p>${paragraphPieces(p,marks).map(piece=>{
   const preserve=p.text.split('\n').filter(line=>/^\s*(?:[-*•]|\d+[.)])\s/.test(line)).length>1
   let text=escape(piece.text)
   if(preserve)text=text.replace(/\n/g,'<br>')
   if(piece.href)text=`<a href="${escape(piece.href)}">${text}</a>`
   const note=visible.find(n=>n.id===piece.noteId)
   return note?`<span data-comment-id="${escape(note.id)}" data-comment-text="${escape(note.text)}" data-comment-type="general" data-comment-author="${note.kind==='private'?'Private':'For the reply'}" data-comment-created-at="${escape(note.createdAt)}">${text}</span>`:text
  }).join('')}</p>`).join('')
 },[article,notes,showPrivate])
 const extensions=useMemo(()=>[...buildExtensions({features:{comments:true,smartTypography:false}}),MailSourceLock],[])
 const changed=(html:string)=>{
  const parsed=new DOMParser().parseFromString(html,'text/html'),ids=new Set<string>()
  const grouped=new Map<string,{quote:string;text:string}>()
  for(const mark of parsed.querySelectorAll<HTMLElement>('[data-comment-id]')){
   const id=mark.dataset.commentId!;ids.add(id)
   const old=grouped.get(id)
   const content=mark.cloneNode(true) as HTMLElement
   content.querySelectorAll('br').forEach(br=>br.replaceWith('\n'))
   grouped.set(id,{quote:(old?.quote??'')+(content.textContent??''),text:mark.dataset.commentText??''})
  }
  for(const [id,mark] of grouped){
   const old=notes.find(n=>n.id===id)
   if(old){if(old.text!==mark.text)void room.updateNote(identity.messageId,id,{text:mark.text});continue}
   const words=mark.quote.trim().split(/\s+/).map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))
   const match=new RegExp(words.join('\\s+')).exec(article.text)
   if(!match)continue
   void room.addNote(identity,{id,kind:noteKind,quote:match[0],start:match.index,end:match.index+match[0].length,text:mark.text,createdAt:new Date().toISOString()})
  }
  for(const note of visible)if(value.includes(`data-comment-id="${escape(note.id)}"`)&&resolveNote(article.text,note)&&!ids.has(note.id))void room.removeNote(identity.messageId,note.id)
 }
 return <DocumentEditor className="mail-annotation-document" value={value} extensions={extensions} enableComments showToolbar={false} onChange={changed} />
}
