import type { PlainSegment } from './plainTextLinks'

function linkLabel(href: string): string {
  if (href.startsWith('tel:')) return href.slice(4)
  const url = new URL(href)
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'teams.microsoft.com') {
    if (url.pathname.includes('meetingOptions')) return 'Meeting options'
    if (url.pathname.includes('meetup-join') || url.pathname.startsWith('/meet/')) return 'Join Microsoft Teams meeting'
  }
  if (host === 'aka.ms' && url.pathname.includes('JoinTeamsMeeting')) return 'Teams meeting help'
  if (host === 'dialin.teams.microsoft.com') {
    return url.pathname.includes('pstnconferencing') ? 'Reset dial-in PIN' : 'Find a local phone number'
  }
  if (host === 'dialin.plcm.vc') return 'Video conference instructions'
  return host
}

/** Format the display only; every destination and the original ICS stay intact. */
export function inviteDescriptionParagraphs(description: string): PlainSegment[][] {
  const links: PlainSegment[] = []
  let marker = '\uE000invite-link-'
  while (description.includes(marker)) marker += '-'
  const text = description.replace(
    /<(https?:\/\/[^<>\s]+|tel:[^<>\s]+)>|\[(https?:\/\/[^\]\s]+)\]|(https?:\/\/[^\s<>]+|tel:\+?[\d,;#()-]+)/gi,
    (_match, angle: string | undefined, bracket: string | undefined, bare: string | undefined) => {
      const raw = angle ?? bracket ?? bare ?? ''
      const punctuation = bare ? raw.match(/[.,;!?]+$/)?.[0] ?? '' : ''
      const href = punctuation ? raw.slice(0, -punctuation.length) : raw
      try {
        const url = new URL(href)
        if (!['https:', 'http:', 'tel:'].includes(url.protocol)) return _match
        links.push({ kind: 'link', href, text: linkLabel(href) })
        return `${marker}${links.length - 1}\uE001${punctuation}`
      } catch { return _match }
    },
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[_—-]{8,}/g, '\n')
    .replace(/[ \t]+(?=(?:Meeting ID:|Passcode:|Dial in by phone|Find a local number|Phone conference ID:|Join on a video conferencing device|Tenant key:|Video ID:|More info|For organizers:|Meeting options|Need help\?|System reference|Reset dial-in PIN))/gi, '\n')
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const token = new RegExp(`${escapedMarker}(\\d+)\uE001`, 'g')
  return text.split(/\n+/).map(line => {
    const segments: PlainSegment[] = []
    let cursor = 0
    for (const match of line.matchAll(token)) {
      let before = line.slice(cursor, match.index).trim()
      const link = { ...links[Number(match[1])]! }
      if (link.kind === 'link') {
        const label = before.match(/(?:Microsoft Teams meeting Join:|Need help\?|System reference|Find a local number|More info|Meeting options|Reset dial-in PIN)$/i)
        if (label) {
          before = before.slice(0, -label[0].length).trim()
          if (/system reference/i.test(label[0])) link.text = 'Meeting reference'
        }
        if (link.href.startsWith('tel:')) {
          const phone = before.match(/(\+?[\d][\d (),;#-]+)$/)?.[1]
          if (phone && phone.replace(/[ ()-]/g, '') === link.href.slice(4).replace(/[ ()-]/g, '')) {
            before = before.slice(0, -phone.length).trim()
            link.text = phone.trim()
          }
        }
      }
      if (before) segments.push({ kind: 'text', text: before + ' ' })
      segments.push(link)
      cursor = match.index! + match[0].length
    }
    const tail = line.slice(cursor).trim().replace(/^\|\s*|\s*\|$/g, '')
    if (tail) segments.push({ kind: 'text', text: (segments.length ? ' ' : '') + tail })
    return segments
  }).filter(segments => segments.length > 0)
}
