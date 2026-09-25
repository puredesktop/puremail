import {
  archiveThread as archiveThreadInStore,
  deleteThread as deleteThreadInStore,
  emptyMailStore,
  labelThread as labelThreadInStore,
  markThreadRead as markThreadReadInStore,
  moveThread as moveThreadInStore,
  unarchiveThread as unarchiveThreadInStore,
} from './mailModel'
import { LocalMailSearchIndex } from './mailSearchIndex'
import type {
  MailMessage,
  MailProvider,
  MailProviderCapabilities,
  MailStore,
  SendDraftInput,
} from '../types'

export class DemoMailProvider implements MailProvider {
  /**
   * Minimal, honest surface: everything the demo provider does is a local
   * in-memory simulation (send appends locally, labels/drafts live in the
   * store). No bulk provider actions.
   */
  readonly capabilities: MailProviderCapabilities = {
    compose: true,
    drafts: true,
    labels: true,
    bulkActions: false,
  }

  private store: MailStore
  private readonly searchIndex: LocalMailSearchIndex

  constructor(seed: MailStore = emptyMailStore()) {
    this.store = seed
    this.searchIndex = new LocalMailSearchIndex(seed)
  }

  async fetchStore(): Promise<MailStore> {
    return this.store
  }

  async sync(store: MailStore): Promise<MailStore> {
    this.store = {
      ...store,
      threads: store.threads.map(thread => ({
        ...thread,
        syncState: 'synced',
      })),
      tasks: store.tasks.map(task => ({ ...task, syncState: 'synced' })),
      drafts: store.drafts.map(draft => ({ ...draft, syncState: 'synced' })),
    }
    this.searchIndex.updateStore(this.store)
    return this.store
  }

  async send(input: SendDraftInput): Promise<MailMessage> {
    const account = this.store.accounts[0]
    if (!account?.email) throw new Error('Connect a mail account before sending.')
    const message: MailMessage = {
      id: `msg_sent_${Date.now()}`,
      threadId: input.threadId,
      from: { name: account.name, email: account.email },
      to: input.draft.to,
      cc: input.draft.cc ?? [],
      bcc: input.draft.bcc ?? [],
      subject: input.draft.subject,
      body: input.draft.body,
      receivedAt: new Date().toISOString(),
      attachments: input.draft.attachments,
      read: true,
    }
    this.store = {
      ...this.store,
      messages: [...this.store.messages, message],
      drafts: this.store.drafts.filter(draft => draft.id !== input.draft.id),
      threads: this.store.threads.map(thread =>
        thread.id === input.threadId
          ? {
              ...thread,
              status: 'waiting',
              lastMessageAt: message.receivedAt,
              syncState: 'pending',
            }
          : thread,
      ),
    }
    this.searchIndex.updateStore(this.store)
    return message
  }

  async search(query: string): Promise<
    Array<{
      id: string
      type: 'thread' | 'message' | 'task' | 'attachment'
      title: string
    }>
  > {
    return this.searchIndex.query(query)
  }

  async labelThread(threadId: string, labelId: string): Promise<void> {
    this.store = labelThreadInStore(this.store, threadId, labelId)
    this.searchIndex.updateStore(this.store)
  }

  async archiveThread(threadId: string): Promise<void> {
    this.store = archiveThreadInStore(this.store, threadId)
    this.searchIndex.updateStore(this.store)
  }

  async unarchiveThread(threadId: string): Promise<void> {
    this.store = unarchiveThreadInStore(this.store, threadId)
    this.searchIndex.updateStore(this.store)
  }


  async moveThread(threadId: string, mailboxId: string): Promise<void> {
    this.store = moveThreadInStore(this.store, threadId, mailboxId)
    this.searchIndex.updateStore(this.store)
  }

  async deleteThread(threadId: string): Promise<void> {
    this.store = deleteThreadInStore(this.store, threadId)
    this.searchIndex.updateStore(this.store)
  }

  async markThreadRead(threadId: string, read: boolean): Promise<void> {
    this.store = markThreadReadInStore(this.store, threadId, read)
    this.searchIndex.updateStore(this.store)
  }
}
