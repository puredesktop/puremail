import {
  cleanMailMessageText,
  deriveReplyIntentForThread,
  isOwnerContact,
  ownerIdentityRegistryForStore,
  draftSourceChangedSinceCreation,
  emailVoiceProfileForStore,
  replyQuestionsForThread,
  resolveDraftCounterparty,
  replyDraftingInstructionsForStore,
  threadContextSummaryForThread,
} from './mailModel'
import type {
  Draft,
  MailMessage,
  MailStore,
  RedraftReason,
  ReplyIntent,
} from '../types'

function latestThreadMessage(
  messages: MailMessage[],
  threadId: string,
): MailMessage | undefined {
  return messages
    .filter(message => message.threadId === threadId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]
}

export function cleanModelDraft(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text|email)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^Subject:\s.*(?:\n|$)/i, '')
    .trim()
}

function buildSystemPrompt(store: MailStore): string {
  return [
    'You draft email replies for PureMail.',
    '',
    'Semantic reply drafting instructions:',
    replyDraftingInstructionsForStore(store),
    '',
    'Use only the supplied email/thread context, person memory, and voice instructions.',
    'Return only the reply body as plain text. No subject line, no markdown fences, no commentary.',
    'The Reply intent section is the contract: answer the owed response for that ask before optimizing tone.',
    'Match the shape of the ask: a yes/no question gets a direct answer first; a scheduling ask states availability; an information ask leads with the information or with exactly what will be confirmed and when.',
    'Do not restate the sender’s email back at them and do not thank them for more than one short clause.',
  ].join('\n')
}

function replyIntentText(intent: ReplyIntent | null): string {
  if (!intent)
    return 'Reply intent: unknown; ask a concise clarifying question.'
  return [
    'Reply intent:',
    `Asker: ${
      intent.asker
        ? `${intent.asker.name || intent.asker.email} <${intent.asker.email}>`
        : 'unknown'
    }`,
    `Recipient: ${
      intent.recipient
        ? `${intent.recipient.name || intent.recipient.email} <${
            intent.recipient.email
          }>`
        : 'unknown'
    }`,
    `Ask type: ${intent.askType}`,
    `Ask text: ${intent.askText}`,
    `Requested action: ${intent.requestedAction}`,
    `Owed response: ${intent.owedResponse}`,
    `Missing information: ${intent.missingInformation.join('; ') || 'none'}`,
    `Confidence: ${intent.confidence}`,
    `Source quote: ${intent.quote}`,
  ].join('\n')
}

function buildDraftMessage(input: {
  store: MailStore
  threadId: string
  previousDraft?: Draft
  intent: 'draft' | 'regenerate'
  userFeedback?: string
  redraftReason?: RedraftReason
}): string {
  const {
    store,
    threadId,
    previousDraft,
    intent,
    userFeedback,
    redraftReason,
  } = input
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread) throw new Error('Thread not found for LLM draft generation.')
  const latest = latestThreadMessage(store.messages, threadId)
  const counterparty = resolveDraftCounterparty(store, thread).counterparty
  const account = store.accounts.find(item => item.id === thread.accountId)
  const voice = emailVoiceProfileForStore(store, thread.accountId)
  const threadContext = threadContextSummaryForThread(store, thread.id)
  const replyIntent =
    previousDraft?.replyIntent &&
    !draftSourceChangedSinceCreation(store, previousDraft)
      ? previousDraft.replyIntent
      : deriveReplyIntentForThread(store, thread.id)
  const latestText = cleanMailMessageText(latest).text
  const questions = replyQuestionsForThread(store, threadId)
  const priorMessages = latest
    ? store.messages
        .filter(
          message => message.threadId === threadId && message.id !== latest.id,
        )
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
        .slice(-3)
    : []

  return [
    `Task: ${
      intent === 'regenerate'
        ? 'Generate a different version of the reply using the same facts.'
        : 'Generate a reply draft.'
    }`,
    '',
    `Account/sender name: ${account?.name ?? 'User'}`,
    `Recipient/counterparty: ${
      counterparty
        ? `${counterparty.name || counterparty.email} <${counterparty.email}>`
        : 'Unknown'
    }`,
    '',
    'Thread:',
    `Subject: ${thread.subject}`,
    `Summary: ${thread.summary}`,
    threadContext
      ? `Current ask: ${threadContext.currentAsk}\nOpen commitments: ${
          threadContext.openCommitments.join('; ') || 'none'
        }\nDeadlines: ${threadContext.deadlines.join('; ') || 'none'}`
      : '',
    replyIntentText(replyIntent),
    '',
    priorMessages.length
      ? [
          'Earlier messages in this thread (context only, oldest first):',
          ...priorMessages.map(message => {
            const text = cleanMailMessageText(message).text
            const trimmed =
              text.length <= 400
                ? text
                : `${text.slice(0, 400).replace(/\s+\S*$/, '')}...`
            return `From ${message.from.name || message.from.email} (${
              message.receivedAt
            }): ${trimmed}`
          }),
          '',
        ].join('\n')
      : '',
    latest && isOwnerContact(latest.from, ownerIdentityRegistryForStore(store))
      ? 'Latest message in the thread — THIS IS YOUR OWN SENT REPLY. Do not answer it. Write a follow-up from you to the counterparty that continues it (a nudge, an addition, or the next step):'
      : 'Latest email to answer:',
    latest
      ? `From: ${latest.from.name || latest.from.email} <${latest.from.email}>
Received: ${latest.receivedAt}
${latestText}`
      : 'No latest message found.',
    '',
    questions.length
      ? [
          'Questions asked in the latest email:',
          ...questions.map((question, index) => `${index + 1}. ${question}`),
          'Rule: answer every question above explicitly. If an answer is not in the supplied context, say plainly what you will confirm and when — never invent it.',
          '',
        ].join('\n')
      : '',
    'My Voice:',
    `Name: ${voice.name}`,
    `Tone: ${voice.tone}`,
    `Length: ${voice.lengthPreference}`,
    `Directness: ${voice.directness}`,
    `Format: ${voice.formattingPreference}`,
    voice.greetingPreference
      ? `Greeting preference: ${voice.greetingPreference}`
      : '',
    voice.signoffPreference
      ? `Signoff preference: ${voice.signoffPreference}`
      : '',
    voice.avoidPhrases.length
      ? `Avoid phrases: ${voice.avoidPhrases.join(', ')}`
      : '',
    '',
    previousDraft
      ? [
          `Redraft reason: ${redraftReason ?? 'retry_after_failure'}`,
          'Redraft rule: keep the same recipient, same ask, and same owed response; change only the requested aspects.',
          'Previous draft to replace:',
          previousDraft.body,
        ].join('\n')
      : '',
    userFeedback
      ? [
          intent === 'draft'
            ? 'User brief for this reply (follow it; it overrides tone defaults):'
            : 'User instruction for this improvement:',
          userFeedback,
        ].join('\n')
      : '',
    '',
    'Return only the reply body.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Context only. The drawer owns all model execution. */
export function prepareReplyContext(input: {
  store: MailStore
  threadId: string
  previousDraft?: Draft
  intent?: 'draft' | 'regenerate'
  userFeedback?: string
  redraftReason?: RedraftReason
}): { instructions: string; context: string } {
  return {
    instructions: buildSystemPrompt(input.store),
    context: buildDraftMessage({ ...input, intent: input.intent ?? (input.previousDraft ? 'regenerate' : 'draft') }),
  }
}
