import type { MailStore, SearchIndex } from '../types'
import { searchMailAndTasks } from './mailModel'

export class LocalMailSearchIndex implements SearchIndex {
  constructor(private store: MailStore) {}

  updateStore(store: MailStore): void {
    this.store = store
  }

  async query(query: string): ReturnType<SearchIndex['query']> {
    return searchMailAndTasks(this.store, query).map(result => ({ ...result }))
  }
}
