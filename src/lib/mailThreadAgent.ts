import { cleanMailMessageText } from './mailModel'
import type { MailStore } from '../types'

/**
 * Phase M5 thread intelligence: "ask the agent about this thread" and
 * thread summarization with task extraction. Analysis-only — these paths
 * never create or send drafts. The transport is injected; the live UI dispatches these prompts to the
 * drawer and displays dispatch status only. There is no internal model transport.
 */
export interface ThreadAgentTransport {
  complete(systemPrompt: string, message: string): Promise<string>
}

function threadContext(store: MailStore, threadId: string): string {
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread) throw new Error('Thread not found.')
  const messages = store.messages
    .filter(message => message.threadId === threadId)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .slice(-8)
  const lines = messages.map(message => {
    const text =
      cleanMailMessageText(message).text || message.body || '(empty)'
    return [
      `From: ${message.from.name} <${message.from.email}>`,
      `Date: ${message.receivedAt}`,
      text.slice(0, 1_500),
    ].join('\n')
  })
  return [`Subject: ${thread.subject}`, '', lines.join('\n---\n')].join('\n')
}

const ANALYSIS_SYSTEM_PROMPT = [
  'You analyze one email thread for its owner.',
  'Answer questions about the thread content only.',
  'Never draft, compose, or send email. Never invent facts not in the thread.',
  'Be concise: plain text, no markdown headings.',
].join(' ')

/** Ask a free-form question about a thread. Analysis only. */
export async function askAgentAboutThread(
  store: MailStore,
  threadId: string,
  question: string,
  transport: ThreadAgentTransport,
): Promise<string> {
  const trimmed = question.trim()
  if (!trimmed) throw new Error('Ask a question first.')
  const message = [
    threadContext(store, threadId),
    '',
    `Question from the mailbox owner: ${trimmed}`,
  ].join('\n')
  return transport.complete(ANALYSIS_SYSTEM_PROMPT, message)
}

export interface ThreadSummary {
  summary: string
  actionItems: string[]
}

const SUMMARY_SYSTEM_PROMPT = [
  'You summarize one email thread for its owner.',
  'Reply with a short plain-text summary paragraph.',
  'Then list concrete action items for the owner, one per line,',
  'each starting with "ACTION: ". No other formatting.',
  'Never draft or send email.',
].join(' ')

/** Parse the model reply into summary + extracted action items. */
export function parseThreadSummaryReply(reply: string): ThreadSummary {
  const lines = reply.split('\n')
  const actionItems = lines
    .filter(line => /^\s*ACTION:\s*/i.test(line))
    .map(line => line.replace(/^\s*ACTION:\s*/i, '').trim())
    .filter(Boolean)
  const summary = lines
    .filter(line => !/^\s*ACTION:\s*/i.test(line))
    .join('\n')
    .trim()
  return { summary, actionItems }
}

/** Summarize a thread and extract one-click task candidates. */
export async function summarizeThread(
  store: MailStore,
  threadId: string,
  transport: ThreadAgentTransport,
): Promise<ThreadSummary> {
  const reply = await transport.complete(
    SUMMARY_SYSTEM_PROMPT,
    threadContext(store, threadId),
  )
  return parseThreadSummaryReply(reply)
}
