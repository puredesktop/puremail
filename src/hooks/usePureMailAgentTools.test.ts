import { expect, it, vi } from 'vitest'
import { AgentMailToolError } from '../agents/catalog'
import { answeringWithoutAccount, NO_ACCOUNT_MESSAGE } from './usePureMailAgentTools'

// An assignment's step reaches PureMail in a background tab where no account is chosen: every tool must answer at
// once (it used to offer none, so each call waited a minute and timed out as "PureMail did not answer").
it('answers every call plainly without an account, and as before with one', async () => {
  const handlers = {
    getMailContext: vi.fn(async () => ({ content: '{"account":null}' })),
    composeMessage: vi.fn(async () => ({ content: 'drafted' })),
  }
  const without = answeringWithoutAccount(false, handlers)
  await expect(without.getMailContext()).resolves.toEqual({ content: '{"account":null}' })
  await expect(without.composeMessage()).rejects.toThrow(AgentMailToolError)
  await expect(without.composeMessage()).rejects.toThrow(NO_ACCOUNT_MESSAGE)
  expect(handlers.composeMessage).not.toHaveBeenCalled()
  expect(answeringWithoutAccount(true, handlers)).toBe(handlers)
})
