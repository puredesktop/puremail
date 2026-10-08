import { evaluateDecision, type DecisionResult } from './decisionModels'
import type { TypedJudgmentRequest } from '@purescience/platform-ui/bridge/typedJudgments.mjs'

/** Uses no mailbox state and never writes a triage verdict. */
export function connectionTestRequest(dailyCap: number): TypedJudgmentRequest {
  return {
    dailyCap,
    state: {
      purpose: 'Synthetic connection test; not a real email',
      testId: crypto.randomUUID(),
      text: 'Could you confirm whether Tuesday at 10am works for our meeting?',
    },
    questions: {
      reply: {
        type: 'choice',
        instructions: 'Does this synthetic message ask its recipient for a reply?',
        criteria: { yes: 'The sender asks for a reply.', no: 'No reply is requested.' },
      },
    },
  }
}

export function connectionTestMessage(result: DecisionResult): string {
  if (result.status === 'completed') {
    return `Connection verified · ${result.model} · ${result.latencyMs} ms. A valid typed response was received. This checks connectivity, not triage quality.`
  }
  switch (result.reason) {
    case 'settings-changed': return 'Decision models/system one models selection changed during the test. Run a new test.'
    case 'missing-key': return 'No decision models/system one models key saved. Add it in desktop Settings → API keys, then test again.'
    case 'daily-cap': return 'Test not run: the daily request limit has been reached.'
    case 'already-attempted': return 'This test was already attempted. Run a new test to verify the connection.'
    case 'local-unavailable': return 'Test failed: no valid local response. Check the local decision runtime and selected model.'
    case 'unavailable': return 'Test failed: no valid response from the decision models/system one models provider. Check the API key and connection, then try again.'
  }
}

export async function testTypedTriageConnection(dailyCap: number) {
  return evaluateDecision(connectionTestRequest(dailyCap))
}
