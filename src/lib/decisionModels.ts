import { bridge } from '@purescience/platform-ui/bridge/client.mjs'
import type { TypedJudgmentRequest, TypedJudgmentResult } from '@purescience/platform-ui/bridge/typedJudgments.mjs'
// Stable bridge entry point lets this app open on desktops predating the service.
// Provider selection, credentials and HTTP remain owned by the shell.
export interface DecisionSettings {
  defaultModelId: string; overrideModelId: string | null; effectiveModelId: string; configured: boolean; today: number;
  models: Array<{id: string; label: string; local: boolean}>;
  recent: Array<{id: string; at: string; model: string; status: string; latencyMs?: number; inputTokens?: number; outputTokens?: number}>;
}
export type DecisionResult =
  | (Omit<Extract<TypedJudgmentResult, {status: 'completed'}>, 'provider'> & {provider?: 'openai' | 'typesafe' | 'local-jev' | 'local'})
  | {status: 'skipped'; reason: Extract<TypedJudgmentResult, {status: 'skipped'}>['reason'] | 'settings-changed'}
export const getDecisionModelSettings = () => bridge.call<DecisionSettings>('decisionModels.settings', [])
export const setDecisionModelOverride = (modelId: string | null) => bridge.call<DecisionSettings>('decisionModels.override', [modelId])
export const evaluateDecision = (request: Omit<TypedJudgmentRequest, 'provider' | 'localModel'>) => bridge.call<DecisionResult>('decisionModels.evaluate', [request])
