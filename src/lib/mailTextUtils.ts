/**
 * Mail text and reader-body utilities, extracted from mailModel.ts (phase 3).
 * A leaf module: everything here resolves within this file plus types.
 */
import type { CleanedMailText, Draft, MailMessage } from '../types'

export interface ReaderMailBody {
  visibleText: string
  fullText: string
  hasCollapsedHistory: boolean
  segments: Array<
    | { type: 'text'; text: string }
    | { type: 'quote'; text: string; label: string }
  >
}

export function stripHtmlToText(html?: string): string {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8202;|&#8203;|&zwnj;|&zwj;/g, '')
    .replace(/[\u200b\u200c\u200d\u200e\u200f\u202f]/g, '')
}

function stripQuotedHtmlHistory(html?: string): {
  html: string
  stripped: string[]
} {
  if (!html) return { html: '', stripped: [] }
  const quoteBoundaries: Array<{ label: string; pattern: RegExp }> = [
    {
      label: 'gmail quoted history',
      pattern: /<div\b[^>]*class=(["'])[^"']*\bgmail_quote\b[^"']*\1/iu,
    },
    {
      label: 'gmail quoted attribution',
      pattern: /<div\b[^>]*class=(["'])[^"']*\bgmail_attr\b[^"']*\1/iu,
    },
    {
      label: 'quoted blockquote',
      pattern:
        /<blockquote\b[^>]*(?:type=(["'])cite\1|class=(["'])[^"']*(?:gmail_quote|AppleMailQuote)[^"']*\2)/iu,
    },
    {
      label: 'mozilla quoted attribution',
      pattern: /<[^>]+\bclass=(["'])[^"']*\bmoz-cite-prefix\b[^"']*\1/iu,
    },
    {
      label: 'yahoo quoted history',
      pattern: /<div\b[^>]*class=(["'])[^"']*\byahoo_quoted\b[^"']*\1/iu,
    },
  ]
  const stripped: string[] = []
  const cutAt = quoteBoundaries.reduce((best, rule) => {
    const match = rule.pattern.exec(html)
    if (!match || match.index <= 0) return best
    stripped.push(rule.label)
    return Math.min(best, match.index)
  }, html.length)
  return {
    html: cutAt < html.length ? html.slice(0, cutAt) : html,
    stripped: [...new Set(stripped)],
  }
}

export function compactMailText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/&#8202;|&#8203;/g, '')
    .replace(/[\u200b\u200c\u200d\u200e\u200f\u202f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function cleanMailMessageText(
  message: MailMessage | undefined | null,
): CleanedMailText {
  const stripped: string[] = []
  const htmlWithoutQuotedHistory = stripQuotedHtmlHistory(message?.bodyHtml)
  stripped.push(...htmlWithoutQuotedHistory.stripped)
  let text = compactMailText(
    htmlWithoutQuotedHistory.stripped.length > 0
      ? stripHtmlToText(htmlWithoutQuotedHistory.html)
      : message?.body || stripHtmlToText(message?.bodyHtml),
  )
  if (!text) return { text: '', stripped }

  const cutRules: Array<{ label: string; pattern: RegExp }> = [
    { label: 'quoted reply boundary', pattern: /(?:^|\n)On .+ wrote:/im },
    {
      label: 'forwarded message boundary',
      pattern: /^[-_\s]{6,}Forwarded message[-_\s]{6,}/im,
    },
    { label: 'forwarded header', pattern: /(?:^|\n)From:\s.+(?:\n|$)/im },
    { label: 'sent header', pattern: /(?:^|\n)Sent:\s.+(?:\n|$)/im },
    { label: 'quoted lines', pattern: /(?:^|\n)>.+/m },
  ]
  const cutAt = cutRules.reduce((best, rule) => {
    const match = rule.pattern.exec(text)
    if (!match || match.index <= 0) return best
    stripped.push(rule.label)
    return Math.min(best, match.index)
  }, text.length)
  if (cutAt < text.length) text = text.slice(0, cutAt)

  const lineRules: Array<{ label: string; pattern: RegExp }> = [
    {
      label: 'information classification footer',
      pattern: /\bInformation Classification:/i,
    },
    { label: 'sent via footer', pattern: /^Sent via\b/i },
    { label: 'unsubscribe footer', pattern: /\bunsubscribe\b/i },
    {
      label: 'tracking or referral link',
      pattern: /\butm_|sprh\.mn|sendgrid\.net|ct\.sendgrid\.net/i,
    },
    { label: 'signature url', pattern: /^https?:\/\/\S+$/i },
    { label: 'signature domain', pattern: /^[a-z0-9.-]+\.[a-z]{2,}$/i },
    {
      label: 'physical address footer',
      pattern: /\b(?:suite|blvd|street|st\.|road|rd\.|city|ca \d{5})\b/i,
    },
  ]

  const keptLines: string[] = []
  let signatureStarted = false
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) {
      if (!signatureStarted) keptLines.push('')
      continue
    }
    const nextLine = lines[index + 1]?.trim() ?? ''
    const lineRule = lineRules.find(rule => rule.pattern.test(line))
    if (lineRule) {
      stripped.push(lineRule.label)
      signatureStarted = true
      continue
    }
    if (
      index > 0 &&
      line.length <= 48 &&
      nextLine &&
      (/^https?:\/\//i.test(nextLine) ||
        /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(nextLine))
    ) {
      stripped.push('signature block')
      signatureStarted = true
      continue
    }
    if (signatureStarted) {
      stripped.push('signature continuation')
      continue
    }
    keptLines.push(line)
  }

  return {
    text: compactMailText(keptLines.join('\n')),
    stripped: [...new Set(stripped)],
  }
}

export function readerMailBody(message: MailMessage): ReaderMailBody {
  const fullText = readerMailFullText(message)
  const cleaned = cleanMailMessageText(message)
  const cleanedVisibleText = cleaned.text || fullText
  const segments = readerMailBodySegments(fullText, cleanedVisibleText, cleaned)
  const visibleText =
    compactMailText(
      segments
        .filter(segment => segment.type === 'text')
        .map(segment => segment.text)
        .join('\n\n'),
    ) ||
    cleanedVisibleText ||
    fullText
  const hasCollapsedHistory = segments.some(segment => segment.type === 'quote')
  return {
    visibleText,
    fullText,
    hasCollapsedHistory,
    segments,
  }
}

function readerMailFullText(message: MailMessage): string {
  const htmlWithoutQuotedHistory = stripQuotedHtmlHistory(message.bodyHtml)
  if (htmlWithoutQuotedHistory.stripped.length > 0 && message.bodyHtml) {
    return compactMailText(stripHtmlToText(message.bodyHtml))
  }
  return compactMailText(message.body || stripHtmlToText(message.bodyHtml))
}

function readerMailBodySegments(
  fullText: string,
  visibleText: string,
  cleaned: CleanedMailText,
): ReaderMailBody['segments'] {
  if (!fullText) return []
  // Only an ATTRIBUTION boundary ("On … wrote:", "From:", a forwarded
  // header, a client's quote container) means "everything below is
  // history". Bare `>` lines do not: interleaved replies quote a line,
  // answer it, and carry on, so treating the first `>` as terminal
  // swallowed the sender's own text after the quote — the reply looked
  // truncated. Those route to the inline segmenter, which keeps text and
  // quotes in document order and handles bottom-quoting just as well.
  const hasTerminalHistory = cleaned.stripped.some(
    label =>
      label !== 'quoted lines' &&
      (label.includes('quoted') || label.includes('forwarded')),
  )
  if (
    !hasTerminalHistory ||
    !visibleText ||
    visibleText.length >= fullText.length
  ) {
    const inlineQuoteSegments = readerInlineQuoteSegments(fullText)
    if (inlineQuoteSegments.some(segment => segment.type === 'quote')) {
      return inlineQuoteSegments
    }
    return [{ type: 'text', text: fullText }]
  }

  const normalizedVisible = compactMailText(visibleText)
  const segments: ReaderMailBody['segments'] = []
  if (normalizedVisible) {
    segments.push({ type: 'text', text: normalizedVisible })
  }
  const quoteStart = readerQuoteHistoryStartIndex(fullText)
  const quoteText = compactMailText(
    quoteStart >= 0
      ? fullText.slice(quoteStart)
      : fullText.startsWith(normalizedVisible)
      ? fullText.slice(normalizedVisible.length)
      : fullText.replace(normalizedVisible, ''),
  )
  if (quoteText) {
    segments.push({ type: 'quote', text: quoteText, label: 'Quoted history' })
  }
  return segments
}

function readerQuoteHistoryStartIndex(fullText: string): number {
  const match = fullText.match(
    /(?:^|\n)(?:On .+ wrote:|From: .+|Sent: .+|>.+)/im,
  )
  return match?.index ?? -1
}

function readerInlineQuoteSegments(
  fullText: string,
): ReaderMailBody['segments'] {
  const lines = fullText.split('\n')
  const segments: ReaderMailBody['segments'] = []
  let textBuffer: string[] = []
  let quoteBuffer: string[] = []
  let quoteLineCount = 0
  let inQuote = false
  let blankLinesInQuote = 0
  // ONLY `>` marks a quoted line in plain-text mail. Bullet markers
  // (`*`, `•`, `-`) are ordinary content: a sender listing availability,
  // options, or next steps writes exactly that shape, and treating it as
  // quoted history hid the real message behind an "Inline quote hidden"
  // box — the body looked truncated mid-sentence. Nothing upstream turns
  // quotes into bullets either: stripHtmlToText drops <li> markup rather
  // than rewriting it, so a bullet in the text was typed by the sender.
  const quoteLinePattern = /^\s*>+\s*\S/

  const flushText = (): void => {
    const text = compactMailText(textBuffer.join('\n'))
    if (text) segments.push({ type: 'text', text })
    textBuffer = []
  }
  const flushQuote = (): void => {
    const text = compactMailText(quoteBuffer.join('\n'))
    if (text && quoteLineCount >= 2) {
      segments.push({ type: 'quote', text, label: 'Inline quote' })
    } else {
      textBuffer.push(...quoteBuffer)
    }
    quoteBuffer = []
    quoteLineCount = 0
    blankLinesInQuote = 0
  }

  lines.forEach((line, index) => {
    const isQuoteLine = quoteLinePattern.test(line)
    if (isQuoteLine) {
      if (!inQuote) flushText()
      inQuote = true
      blankLinesInQuote = 0
      quoteLineCount += 1
      quoteBuffer.push(line)
      return
    }
    if (inQuote) {
      if (!line.trim()) {
        blankLinesInQuote += 1
        quoteBuffer.push(line)
        return
      }
      const nextQuoteLineIndex = lines.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && quoteLinePattern.test(candidate),
      )
      if (blankLinesInQuote === 0 || nextQuoteLineIndex >= 0) {
        quoteBuffer.push(line)
        blankLinesInQuote = 0
        return
      }
      flushQuote()
      inQuote = false
    }
    textBuffer.push(line)
  })
  if (inQuote) flushQuote()
  flushText()

  return segments.length > 0 ? segments : [{ type: 'text', text: fullText }]
}

export function sourceExcerptForDraft(message: MailMessage | undefined): string {
  const raw = cleanMailMessageText(message).text
  if (!raw) return ''

  const cutPatterns = [
    /\bInformation Classification:/i,
    /^[-_\s]{6,}Forwarded message[-_\s]{6,}/im,
    /(?:^|\n)From:\s.+/im,
    /(?:^|\n)Sent:\s.+/im,
    /(?:^|\n)On .+ wrote:/im,
    /(?:^|\n)>.+/m,
  ]
  const cutAt = cutPatterns.reduce((best, pattern) => {
    const match = pattern.exec(raw)
    if (!match || match.index <= 0) return best
    return Math.min(best, match.index)
  }, raw.length)

  const excerpt = compactMailText(raw.slice(0, cutAt))
  if (!excerpt) return ''
  if (excerpt.length <= 420) return excerpt
  return `${excerpt.slice(0, 420).replace(/\s+\S*$/, '')}...`
}

export function draftRegenerationIndex(draft: Draft | undefined): number {
  if (!draft) return 0
  return (draft.provenance ?? []).filter(item =>
    /^Regenerated draft at\b/.test(item),
  ).length
}
