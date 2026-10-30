import { bridge } from '@purescience/platform-ui/bridge/client.mjs'
import type { TypedJudgmentRequest, TypedJudgmentResult } from '@purescience/platform-ui/bridge/typedJudgments.mjs'
// Stable bridge entry point lets this app open on desktops predating the service.
// Provider selection, credentials and HTTP remain owned by the shell.
export interface DecisionSettings {
  defaultModelId: string; overrideModelId: string | null; effectiveModelId: string; configured: boolean; today: number;
  /** From Settings › Models in the desktop. `sendsContentTo` names whose servers a hosted model sends content to. */
  models: Array<{id: string; label: string; local: boolean; provider?: string; sendsContentTo?: string; supportsImages?: boolean}>;
  recent: Array<{id: string; at: string; model: string; status: string; latencyMs?: number; inputTokens?: number; outputTokens?: number}>;
}
export type DecisionResult =
  | Extract<TypedJudgmentResult, {status: 'completed'}>
  | {status: 'skipped'; reason: Extract<TypedJudgmentResult, {status: 'skipped'}>['reason'] | 'settings-changed'}
export const getDecisionModelSettings = () => bridge.call<DecisionSettings>('decisionModels.settings', [])
export const setDecisionModelOverride = (modelId: string | null) => bridge.call<DecisionSettings>('decisionModels.override', [modelId])
export const evaluateDecision = (request: Omit<TypedJudgmentRequest, 'provider' | 'localModel'>) => bridge.call<DecisionResult>('decisionModels.evaluate', [request])

/** Whether a decision ran on this device. Local models self-report their confidence; hosted ones are calibrated by their provider. */
export const isLocalDecisionProvider = (provider: string | undefined) => provider === 'local' || provider === 'local-jev'
/** The chosen model, as the desktop describes it. Mail never assumes which provider or model that is. */
export const effectiveDecisionModel = (settings: DecisionSettings | null) => settings?.models.find(model => model.id === settings.effectiveModelId) ?? null
