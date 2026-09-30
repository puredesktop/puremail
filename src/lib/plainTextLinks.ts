/**
 * Links in a plain-text message. Plain parts of HTML newsletters write every
 * link as `Label [https://long-tracking-url]`, which read as walls of URL.
 * Here the label becomes the link and the bracketed URL disappears; a bracket
 * with no label becomes a short domain link; a bare URL shows as its domain.
 */
export type PlainSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }

const LINKS = /\[\s*(https?:\/\/[^\]\s]+)\s*\]|(https?:\/\/[^\s<>"'\]]+)/gi
const TRAILING = /[.,;:!?)]+$/
const BULLET = /^(\s*(?:[*•\-–]|\d+[.)])\s+)/

export function linkDomain(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}

function bareLabel(href: string): string {
  try {
    const url = new URL(href)
    const host = url.hostname.replace(/^www\./, '')
    return url.pathname.length > 1 || url.search ? `${host}/…` : host
  } catch {
    return href
  }
}

export function plainTextSegments(paragraph: string): PlainSegment[] {
  const out: PlainSegment[] = []
  const pushText = (text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += text
    else out.push({ kind: 'text', text })
  }
  let cursor = 0
  for (const match of paragraph.matchAll(LINKS)) {
    const start = match.index ?? 0
    const before = paragraph.slice(cursor, start)
    if (match[1]) {
      const href = match[1]
      // The label is the last line of text before the bracket; when the bracket
      // starts its own line, the line above it.
      const trimmed = before.replace(/[ \t]+$/, '')
      const lines = trimmed.split('\n')
      let labelLine = lines[lines.length - 1] ?? ''
      let head = lines.slice(0, -1).join('\n') + (lines.length > 1 ? '\n' : '')
      let tail = ''
      if (!labelLine.trim() && lines.length > 1) {
        labelLine = lines[lines.length - 2] ?? ''
        head = lines.slice(0, -2).join('\n') + (lines.length > 2 ? '\n' : '')
        tail = '\n'
      }
      const bullet = labelLine.match(BULLET)?.[1] ?? ''
      const label = labelLine.slice(bullet.length).trim()
      if (label) {
        pushText(head + bullet)
        out.push({ kind: 'link', text: label, href })
        pushText(tail.trim() ? tail : '')
      } else {
        pushText(before)
        out.push({ kind: 'link', text: `${linkDomain(href)} ↗`, href })
      }
    } else {
      const raw = match[2] ?? ''
      const punctuation = raw.match(TRAILING)?.[0] ?? ''
      const href = punctuation ? raw.slice(0, -punctuation.length) : raw
      pushText(before)
      out.push({ kind: 'link', text: bareLabel(href), href })
      pushText(punctuation)
    }
    cursor = start + match[0].length
  }
  pushText(paragraph.slice(cursor))
  return out
}
