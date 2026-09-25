import { describe, expect, it } from 'vitest'
import { demoMailStore } from './mailModel'
import { LocalMailSearchIndex } from './mailSearchIndex'

describe('LocalMailSearchIndex', () => {
  it('queries unified mail, attachment, and task results through the SearchIndex boundary', async () => {
    const index = new LocalMailSearchIndex(demoMailStore())

    const launchResults = await index.query('launch')
    expect(launchResults.some(result => result.type === 'thread')).toBe(true)
    expect(launchResults.some(result => result.type === 'message')).toBe(true)
    expect(launchResults.some(result => result.type === 'task')).toBe(true)

    const attachmentResults = await index.query('screens')
    expect(attachmentResults).toContainEqual(
      expect.objectContaining({
        type: 'attachment',
        title: 'screens.zip',
      }),
    )
  })

  it('returns cloned result objects from the current store snapshot', async () => {
    const store = demoMailStore()
    const index = new LocalMailSearchIndex(store)
    const firstResults = await index.query('launch')
    firstResults[0]!.title = 'mutated'

    expect((await index.query('launch'))[0]?.title).not.toBe('mutated')

    index.updateStore({
      ...store,
      threads: store.threads.map(thread =>
        thread.id === 'thread_launch'
          ? { ...thread, subject: 'Renamed launch thread' }
          : thread,
      ),
    })

    expect((await index.query('renamed launch'))[0]).toMatchObject({
      type: 'thread',
      title: 'Renamed launch thread',
    })
  })
})
