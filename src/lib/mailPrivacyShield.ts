import type { MailAuthResults, MailAuthVerdict, MailMessage } from '../types'

export interface TrackerHit {
  vendor: string
  url: string
  reason: 'known-tracker' | 'pixel-beacon'
}

export interface LinkWarning {
  displayText: string
  href: string
  reason:
    | 'domain-mismatch'
    | 'punycode'
    | 'ip-literal'
    | 'suspicious-scheme'
}

export interface MailPrivacyReport {
  trackers: TrackerHit[]
  linkWarnings: LinkWarning[]
  senderMismatch: { fromDomain: string; replyOrReturnDomain: string } | null
  auth: MailAuthResults
}

interface TrackerSignature {
  vendor: string
  /** Matches against normalized `${hostname}${pathname}` (never query string). */
  pattern: RegExp
}

const KNOWN_TRACKER_SIGNATURES: readonly TrackerSignature[] = [
  { vendor: 'Mailchimp', pattern: /(?:^|\.)(?:list-manage\.com|mailchimp\.com)\/track\/open/i },
  { vendor: 'HubSpot', pattern: /(?:^|\.)(?:t\.sidekickopen\d*\.com|track\.hubspot\.com|hubspotlinks\.com|hs-analytics\.net)(?:\/|$)|(?:^|\.)email\.hsforms\.net\/e3t\/o/i },
  { vendor: 'Mixmax', pattern: /(?:^|\.)(?:email|app)\.mixmax\.com\/api\/track/i },
  { vendor: 'Superhuman', pattern: /(?:^|\.)r\.superhuman\.com(?:\/|$)/i },
  { vendor: 'Mailtrack', pattern: /(?:^|\.)mailtrack\.io\/(?:trace|pixel)/i },
  { vendor: 'SendGrid', pattern: /(?:^|\.)(?:ct\.)?sendgrid\.net\/wf\/open/i },
  { vendor: 'Klaviyo', pattern: /(?:^|\.)c?trk\.klclick\d*\.com(?:\/|$)/i },
  { vendor: 'Salesforce / Pardot', pattern: /(?:^|\.)(?:go|pi)\.pardot\.com\/|(?:^|\.)salesforceiq\.com\/t\.png|(?:^|\.)exacttarget\.com\/open\.aspx|(?:^|\.)salesforce\.com\/servlet\/servlet\.ImageServer/i },
  { vendor: 'Marketo', pattern: /(?:^|\.)mktotracking\.com(?:\/|$)|(?:^|\.)mkto-[a-z0-9-]+\.com\/trk/i },
  { vendor: 'Constant Contact', pattern: /(?:^|\.)(?:r20\.rs6\.net|constantcontact\.com)\/on\.jsp/i },
  { vendor: 'ConvertKit', pattern: /(?:^|\.)open\.convertkit-mail\d*\.com(?:\/|$)|(?:^|\.)convertkit-mail\d*\.com\/o\//i },
  { vendor: 'Substack', pattern: /(?:^|\.)open\.substack\.com(?:\/|$)|(?:^|\.)substack\.com\/api\/v1\/email\/open|(?:^|\.)email\.mg\.substack\.com\/o\//i },
  { vendor: 'Customer.io', pattern: /(?:^|\.)e\.customeriomail\.com\/e\/o\/|(?:^|\.)track\.customer\.io(?:\/|$)/i },
  { vendor: 'Intercom', pattern: /(?:^|\.)(?:via\.)?intercom-mail\.com\/o(?:\/|$)/i },
  { vendor: 'Braze', pattern: /(?:^|\.)(?:braze|appboy)\.com\/wf\/open|(?:^|\.)ablink\.[a-z0-9.-]+\/wf\/open/i },
  { vendor: 'Postmark', pattern: /(?:^|\.)(?:ea\.)?pstmrk\.it\/open|(?:^|\.)postmarkapp\.com\/open/i },
  { vendor: 'Mailgun', pattern: /(?:^|\.)email\.mailgun\.(?:net|org)\/o\//i },
  { vendor: 'Yesware', pattern: /(?:^|\.)t\.yesware\.com\/t\//i },
  { vendor: 'Streak', pattern: /(?:^|\.)mailfoogae\.appspot\.com\/t/i },
  { vendor: 'Litmus', pattern: /(?:^|\.)emltrk\.com\//i },
  { vendor: 'ActiveCampaign', pattern: /(?:^|\.)activehosted\.com\/lt\.php/i },
]

const TRUSTED_BOUNCE_ROOT_DOMAINS = new Set([
  'amazonses.com',
  'sendgrid.net',
  'mailgun.org',
  'mailgun.net',
  'mandrillapp.com',
  'postmarkapp.com',
  'sparkpostmail.com',
  'mcsv.net',
  'rsgsv.net',
  'mcdlv.net',
  'hubspotemail.net',
  'intercom-mail.com',
  'customeriomail.com',
  'zendesk.com',
  'freshdesk.com',
  'salesforce.com',
  'exacttarget.com',
])

const TRUSTED_BOUNCE_EXACT_OR_SUBDOMAINS = new Set([
  'bounces.google.com',
  'bounce.google.com',
  'gaia.bounces.google.com',
])

const TWO_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'nhs.uk',
  'com.au',
  'net.au',
  'org.au',
  'gov.au',
  'edu.au',
  'co.nz',
  'co.jp',
  'ac.jp',
  'or.jp',
  'ne.jp',
  'com.br',
  'com.mx',
  'co.in',
  'org.in',
  'com.sg',
  'com.hk',
  'co.za',
  'co.kr',
  'com.tw',
  'com.cn',
  'co.il',
  'com.tr',
  'com.ar',
  'com.pl',
  'com.my',
  'com.co',
  'com.ua',
  'co.id',
  'github.io',
  'herokuapp.com',
])

function normalizeVerdict(raw: string | undefined): MailAuthVerdict {
  const token = (raw ?? '').trim().toLowerCase()
  if (!token || token === 'none') return 'none'
  if (token === 'pass' || token === 'bestguesspass') return 'pass'
  if (
    token === 'fail' ||
    token === 'hardfail' ||
    token === 'permerror' ||
    token === 'policy'
  ) {
    return 'fail'
  }
  if (
    token === 'softfail' ||
    token === 'neutral' ||
    token === 'temperror' ||
    token === 'unknown'
  ) {
    return 'neutral'
  }
  return 'none'
}

/**
 * Strip RFC 5322 comments (including nested parentheses) and quoted strings so
 * attacker-controlled text inside comments or quoted parameters cannot spoof
 * `spf=pass` / `dkim=pass` / `dmarc=pass`.
 */
function stripRfc5322CommentsAndQuotes(input: string): string {
  let out = ''
  let commentDepth = 0
  let inQuotes = false
  let escaped = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && (inQuotes || commentDepth > 0)) {
      escaped = true
      continue
    }
    if (commentDepth > 0) {
      if (ch === '(') commentDepth += 1
      else if (ch === ')') {
        commentDepth -= 1
        if (commentDepth === 0) out += ' '
      }
      continue
    }
    if (inQuotes) {
      if (ch === '"') {
        inQuotes = false
        out += ' '
      }
      continue
    }
    if (ch === '(') {
      commentDepth = 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    out += ch
  }
  return out
}

function mergeMechanismVerdict(
  current: MailAuthVerdict,
  incoming: MailAuthVerdict,
): MailAuthVerdict {
  // Never let a third-party `pass` override a `fail`.
  if (current === 'fail' || incoming === 'fail') return 'fail'
  if (current === 'pass' || incoming === 'pass') return 'pass'
  if (current === 'neutral' || incoming === 'neutral') return 'neutral'
  return 'none'
}

/**
 * Parse RFC 7601 Authentication-Results (strictly topmost header) and optional
 * Received-SPF fallback. Never trusts verdicts extracted from the
 * sender-controlled DKIM-Signature header.
 */
export function parseAuthenticationResults(
  authHeader?: string,
  spfHeader?: string,
  dkimHeader?: string,
): MailAuthResults {
  const authText = (authHeader ?? '').trim()
  const spfText = (spfHeader ?? '').trim()
  const dkimText = (dkimHeader ?? '').trim()

  let spf: MailAuthVerdict = 'none'
  let dkim: MailAuthVerdict = 'none'
  let dmarc: MailAuthVerdict = 'none'

  if (authText) {
    const cleaned = stripRfc5322CommentsAndQuotes(authText)
    const rawClauses = cleaned.split(';').map(clause => clause.trim()).filter(Boolean)
    // RFC 7601: first clause is authserv-id unless the header omits it and starts directly with a method.
    const clauses =
      rawClauses.length > 0 &&
      !/^(?:spf|dkim|dmarc)\s*=/i.test(rawClauses[0]!)
        ? rawClauses.slice(1)
        : rawClauses

    for (const clause of clauses) {
      const match = /^(spf|dkim|dmarc)\s*=\s*([a-z]+)/i.exec(clause)
      if (!match) continue
      const mechanism = match[1]!.toLowerCase()
      const verdict = normalizeVerdict(match[2])
      if (mechanism === 'spf') spf = mergeMechanismVerdict(spf, verdict)
      else if (mechanism === 'dkim') dkim = mergeMechanismVerdict(dkim, verdict)
      else if (mechanism === 'dmarc') dmarc = mergeMechanismVerdict(dmarc, verdict)
    }
  }

  if (spf === 'none' && spfText) {
    const cleanedSpf = stripRfc5322CommentsAndQuotes(spfText).trim()
    const leading = /^([a-z]+)\b/i.exec(cleanedSpf)?.[1]
    spf = normalizeVerdict(leading)
  }

  // DKIM-Signature is sender-controlled: NEVER extract `pass`/`fail` verdicts from it.
  // Presence of a syntactically plausible signature without Authentication-Results is only `neutral` (unverified).
  if (dkim === 'none' && dkimText) {
    if (/\bd=[^;\s]+/i.test(dkimText) && /\bb=[^;\s]+/i.test(dkimText)) {
      dkim = 'neutral'
    }
  }

  const raw = authText || spfText || undefined
  return {
    spf,
    dkim,
    dmarc,
    ...(raw ? { raw } : {}),
  }
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi,
    (whole, entity: string) => {
      const lower = entity.toLowerCase()
      if (lower === 'amp') return '&'
      if (lower === 'lt') return '<'
      if (lower === 'gt') return '>'
      if (lower === 'quot') return '"'
      if (lower === 'apos' || lower === '#39') return "'"
      if (lower.startsWith('#x')) {
        const code = Number.parseInt(lower.slice(2), 16)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole
      }
      if (lower.startsWith('#')) {
        const code = Number.parseInt(lower.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole
      }
      return whole
    },
  )
}

function normalizeRemoteHttpUrl(rawUrl: string): URL | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = rawUrl.replace(/[\t\r\n]/g, '').replace(/^[\u0000-\u0020]+/, '').trim()
  if (!cleaned || /^data:/i.test(cleaned) || /^cid:/i.test(cleaned)) {
    return null
  }
  let candidate = cleaned
  if (/^[/\\]{2}/.test(candidate)) {
    candidate = `https://${candidate.replace(/^[/\\]+/, '')}`
  } else if (/^https?:[/\\]/i.test(candidate)) {
    candidate = candidate.replace(/^(https?:)[/\\]+/i, '$1//')
  }
  if (!/^https?:\/\//i.test(candidate)) return null
  try {
    return new URL(candidate)
  } catch {
    return null
  }
}

function isRemoteHttpUrl(url: string): boolean {
  return normalizeRemoteHttpUrl(url) !== null
}

function matchKnownTracker(url: string): string | null {
  const parsed = normalizeRemoteHttpUrl(url)
  if (!parsed) return null
  const hostPath = `${parsed.hostname.toLowerCase()}${parsed.pathname}`
  for (const sig of KNOWN_TRACKER_SIGNATURES) {
    if (sig.pattern.test(hostPath)) return sig.vendor
  }
  return null
}

function parsePixelSize(raw: string | null | undefined): number | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  const match = /^(\d+(?:\.\d+)?|\.\d+)\s*(px|pt|em|rem|%)?$/.exec(trimmed)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  const unit = match[2] ?? 'px'
  if (unit === 'px') return amount
  if (unit === 'pt') return amount * 1.3333
  if (unit === 'em' || unit === 'rem') return amount * 16
  if (unit === '%') return amount === 0 ? 0 : null
  return null
}

function parseOpacityZero(val: string): boolean {
  const trimmed = val.trim().toLowerCase()
  const match = /^(\d+(?:\.\d+)?|\.\d+)(%)?$/.exec(trimmed)
  if (!match) return false
  return Number(match[1]) === 0
}

function stripCssComments(style: string): string {
  return style.replace(/\/\*[\s\S]*?\*\//g, '')
}

function styleDimensionsAndVisibility(style: string | null | undefined): {
  width: number | null
  height: number | null
  hidden: boolean
} {
  if (!style) return { width: null, height: null, hidden: false }
  let width: number | null = null
  let height: number | null = null
  let hidden = false
  const cleaned = stripCssComments(style)
  for (const part of cleaned.split(';')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const prop = part.slice(0, idx).trim().toLowerCase()
    const val = part
      .slice(idx + 1)
      .replace(/!important\s*$/i, '')
      .trim()
      .toLowerCase()
    if (prop === 'width' || prop === 'max-width') {
      const parsed = parsePixelSize(val)
      if (parsed !== null) {
        width = width === null ? parsed : Math.min(width, parsed)
      }
    } else if (prop === 'height' || prop === 'max-height') {
      const parsed = parsePixelSize(val)
      if (parsed !== null) {
        height = height === null ? parsed : Math.min(height, parsed)
      }
    } else if (
      (prop === 'display' && val === 'none') ||
      (prop === 'visibility' && val === 'hidden') ||
      (prop === 'opacity' && parseOpacityZero(val))
    ) {
      hidden = true
    }
  }
  return { width, height, hidden }
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

function isPixelBeaconAttrs(
  src: string,
  widthAttr: string | null | undefined,
  heightAttr: string | null | undefined,
  styleAttr: string | null | undefined,
): boolean {
  if (!isRemoteHttpUrl(src)) return false
  const styleInfo = styleDimensionsAndVisibility(styleAttr)
  if (styleInfo.hidden) return true
  const w = minNullable(parsePixelSize(widthAttr), styleInfo.width)
  const h = minNullable(parsePixelSize(heightAttr), styleInfo.height)
  if (w !== null && h !== null && w <= 1 && h <= 1) return true
  if ((w !== null && w === 0) || (h !== null && h === 0)) return true
  return false
}

function trackerHostLabel(url: string): string {
  const parsed = normalizeRemoteHttpUrl(url)
  return parsed?.hostname || 'Unknown tracker'
}

function parseSrcsetUrls(rawSrcset: string): string[] {
  const urls: string[] = []
  const s = rawSrcset.trim()
  let i = 0
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i]!)) i += 1
    if (i >= s.length) break
    const start = i
    if (/^data:/i.test(s.slice(i))) {
      while (i < s.length && !/\s/.test(s[i]!)) i += 1
    } else {
      while (i < s.length && !/[\s,]/.test(s[i]!)) i += 1
    }
    const url = s.slice(start, i)
    if (url) urls.push(url)
    while (i < s.length && s[i] !== ',') i += 1
    if (i < s.length && s[i] === ',') i += 1
  }
  return urls
}

function stripTrackerUrlsFromStyle(
  style: string,
  trackers: TrackerHit[],
): { style: string; changed: boolean } {
  const cleaned = stripCssComments(style)
  let changed = false
  const keptDeclarations: string[] = []
  for (const part of cleaned.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx < 0) {
      keptDeclarations.push(trimmed)
      continue
    }
    const prop = trimmed.slice(0, idx).trim().toLowerCase()
    const val = trimmed.slice(idx + 1).trim()
    if (prop === 'background' || prop === 'background-image') {
      let hasTracker = false
      const urlMatches = val.matchAll(/url\(\s*(?:["'])?([^"')]+)(?:["'])?\s*\)/gi)
      for (const m of urlMatches) {
        const candidateUrl = decodeHtmlEntities((m[1] ?? '').trim())
        const vendor = matchKnownTracker(candidateUrl)
        if (vendor) {
          trackers.push({ vendor, url: candidateUrl, reason: 'known-tracker' })
          hasTracker = true
        }
      }
      if (hasTracker) {
        changed = true
        continue
      }
    }
    keptDeclarations.push(trimmed)
  }
  return { style: keptDeclarations.join('; '), changed }
}

function extractAttrFromTag(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+))`,
    'i',
  )
  const match = re.exec(attrs)
  if (!match) return null
  const raw = match[1] ?? match[2] ?? match[3] ?? null
  return raw === null ? null : decodeHtmlEntities(raw)
}

/**
 * Detect and strip known email open-tracking pixels, hidden/1x1 external
 * beacon images, tracker `srcset` URLs, and CSS background tracker URLs from
 * HTML. Works in both DOM (browser / happy-dom) and plain Node environments.
 */
export function stripTrackingPixels(html: string): {
  html: string
  trackers: TrackerHit[]
} {
  if (!html) return { html: '', trackers: [] }
  const trackers: TrackerHit[] = []

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')

    for (const img of [...doc.body.querySelectorAll('img')]) {
      const src =
        img.getAttribute('src') ??
        img.getAttribute('data-puremail-blocked-src') ??
        ''
      const srcset =
        img.getAttribute('srcset') ??
        img.getAttribute('data-puremail-blocked-srcset') ??
        ''
      const srcsetUrls = srcset ? parseSrcsetUrls(srcset) : []
      const srcsetTrackerUrl = srcsetUrls.find(u => matchKnownTracker(u) !== null)

      const knownVendor = src
        ? matchKnownTracker(src)
        : srcsetTrackerUrl
          ? matchKnownTracker(srcsetTrackerUrl)
          : null

      if (knownVendor) {
        trackers.push({
          vendor: knownVendor,
          url: src || srcsetTrackerUrl!,
          reason: 'known-tracker',
        })
        img.remove()
        continue
      }
      if (srcsetTrackerUrl) {
        const vendor = matchKnownTracker(srcsetTrackerUrl)!
        trackers.push({ vendor, url: srcsetTrackerUrl, reason: 'known-tracker' })
        img.remove()
        continue
      }
      const primaryUrl = src || srcsetUrls[0] || ''
      if (
        primaryUrl &&
        isPixelBeaconAttrs(
          primaryUrl,
          img.getAttribute('width'),
          img.getAttribute('height'),
          img.getAttribute('style'),
        )
      ) {
        trackers.push({
          vendor: trackerHostLabel(primaryUrl),
          url: primaryUrl,
          reason: 'pixel-beacon',
        })
        img.remove()
      }
    }

    for (const source of [...doc.body.querySelectorAll('source')]) {
      const srcset =
        source.getAttribute('srcset') ??
        source.getAttribute('data-puremail-blocked-srcset') ??
        source.getAttribute('src') ??
        ''
      if (!srcset) continue
      const urls = parseSrcsetUrls(srcset)
      const trackerUrl = urls.find(u => matchKnownTracker(u) !== null)
      if (trackerUrl) {
        trackers.push({
          vendor: matchKnownTracker(trackerUrl)!,
          url: trackerUrl,
          reason: 'known-tracker',
        })
        source.remove()
      }
    }

    for (const el of [...doc.body.querySelectorAll('*')]) {
      const bg = el.getAttribute('background')
      if (bg) {
        const vendor = matchKnownTracker(bg)
        if (vendor) {
          trackers.push({ vendor, url: bg, reason: 'known-tracker' })
          el.removeAttribute('background')
        }
      }
      const style = el.getAttribute('style')
      if (style && /url\(/i.test(style)) {
        const result = stripTrackerUrlsFromStyle(style, trackers)
        if (result.changed) {
          if (result.style) el.setAttribute('style', result.style)
          else el.removeAttribute('style')
        }
      }
    }

    return { html: doc.body.innerHTML, trackers }
  }

  // Node fallback without DOMParser — handles quoted `>` inside attributes safely.
  let stripped = html.replace(
    /<img\b((?:"[^"]*"|'[^']*'|[^'">])*?)\/?\s*>/gi,
    (whole, attrs: string) => {
      const src =
        extractAttrFromTag(attrs, 'src') ??
        extractAttrFromTag(attrs, 'data-puremail-blocked-src') ??
        ''
      const srcset =
        extractAttrFromTag(attrs, 'srcset') ??
        extractAttrFromTag(attrs, 'data-puremail-blocked-srcset') ??
        ''
      const srcsetUrls = srcset ? parseSrcsetUrls(srcset) : []
      const srcsetTrackerUrl = srcsetUrls.find(u => matchKnownTracker(u) !== null)
      const knownVendor = src
        ? matchKnownTracker(src)
        : srcsetTrackerUrl
          ? matchKnownTracker(srcsetTrackerUrl)
          : null
      if (knownVendor) {
        trackers.push({
          vendor: knownVendor,
          url: src || srcsetTrackerUrl!,
          reason: 'known-tracker',
        })
        return ''
      }
      if (srcsetTrackerUrl) {
        trackers.push({
          vendor: matchKnownTracker(srcsetTrackerUrl)!,
          url: srcsetTrackerUrl,
          reason: 'known-tracker',
        })
        return ''
      }
      const primaryUrl = src || srcsetUrls[0] || ''
      if (
        primaryUrl &&
        isPixelBeaconAttrs(
          primaryUrl,
          extractAttrFromTag(attrs, 'width'),
          extractAttrFromTag(attrs, 'height'),
          extractAttrFromTag(attrs, 'style'),
        )
      ) {
        trackers.push({
          vendor: trackerHostLabel(primaryUrl),
          url: primaryUrl,
          reason: 'pixel-beacon',
        })
        return ''
      }
      return whole
    },
  )

  stripped = stripped.replace(
    /<source\b((?:"[^"]*"|'[^']*'|[^'">])*?)\/?\s*>/gi,
    (whole, attrs: string) => {
      const srcset =
        extractAttrFromTag(attrs, 'srcset') ??
        extractAttrFromTag(attrs, 'data-puremail-blocked-srcset') ??
        extractAttrFromTag(attrs, 'src') ??
        ''
      if (!srcset) return whole
      const trackerUrl = parseSrcsetUrls(srcset).find(
        u => matchKnownTracker(u) !== null,
      )
      if (trackerUrl) {
        trackers.push({
          vendor: matchKnownTracker(trackerUrl)!,
          url: trackerUrl,
          reason: 'known-tracker',
        })
        return ''
      }
      return whole
    },
  )

  stripped = stripped.replace(
    /<([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi,
    (whole, tag: string, attrs: string) => {
      if (!/background/i.test(attrs)) return whole
      let nextAttrs = attrs
      const bg = extractAttrFromTag(attrs, 'background')
      if (bg) {
        const vendor = matchKnownTracker(bg)
        if (vendor) {
          trackers.push({ vendor, url: bg, reason: 'known-tracker' })
          nextAttrs = nextAttrs.replace(
            /\s+background\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/i,
            '',
          )
        }
      }
      const style = extractAttrFromTag(nextAttrs, 'style')
      if (style && /url\(/i.test(style)) {
        const result = stripTrackerUrlsFromStyle(style, trackers)
        if (result.changed) {
          nextAttrs = nextAttrs.replace(
            /(\s+style\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/i,
            result.style ? `$1"${result.style.replace(/"/g, '&quot;')}"` : '',
          )
        }
      }
      return `<${tag}${nextAttrs}>`
    },
  )

  return { html: stripped, trackers }
}

function registrableDomain(hostname: string): string {
  const clean = hostname.trim().toLowerCase().replace(/\.+$/, '')
  const parts = clean.split('.').filter(Boolean)
  if (parts.length <= 2) return clean
  const lastTwo = parts.slice(-2).join('.')
  if (TWO_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return lastTwo
}

function isTrustedBounceDomain(domain: string): boolean {
  const clean = domain.trim().toLowerCase().replace(/\.+$/, '')
  if (TRUSTED_BOUNCE_EXACT_OR_SUBDOMAINS.has(clean)) return true
  for (const suffix of TRUSTED_BOUNCE_EXACT_OR_SUBDOMAINS) {
    if (clean.endsWith(`.${suffix}`)) return true
  }
  return TRUSTED_BOUNCE_ROOT_DOMAINS.has(registrableDomain(clean))
}

function emailDomain(rawEmail: string | undefined): string | null {
  if (!rawEmail) return null
  const angleMatch = /<([^<>]+)>/.exec(rawEmail)
  const address = (angleMatch?.[1] ?? rawEmail).trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at < 0) return null
  const domain = address.slice(at + 1).replace(/[>\s.]+$/, '')
  return domain || null
}

function isIpLiteral(hostname: string): boolean {
  if (!hostname) return false
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true
  if (hostname.includes(':')) return true
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true
  if (/^0x[0-9a-f]+$/i.test(hostname) || /^\d+$/.test(hostname)) return true
  return false
}

function extractDomainFromDisplayText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 200) return null
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname.toLowerCase()
    } catch {
      return null
    }
  }
  const bareDomain =
    /^(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?:\/[^\s]*)?$/i.exec(
      trimmed,
    )
  if (!bareDomain) return null
  const host = bareDomain[1]!.toLowerCase()
  const tld = host.split('.').pop() ?? ''
  if (
    /^(?:pdf|docx?|xlsx?|pptx?|csv|txt|png|jpe?g|gif|zip|ics|eml|md)$/i.test(
      tld,
    )
  ) {
    return null
  }
  return host
}

function inspectAnchors(html: string): LinkWarning[] {
  if (!html) return []
  const pairs: Array<{ href: string; displayText: string }> = []

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const anchor of doc.body.querySelectorAll('a[href]')) {
      pairs.push({
        href: (anchor.getAttribute('href') ?? '').trim(),
        displayText: (anchor.textContent ?? '').trim(),
      })
    }
  } else {
    const anchorRe = /<a\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/a>/gi
    for (const match of html.matchAll(anchorRe)) {
      const href = (extractAttrFromTag(match[1] ?? '', 'href') ?? '').trim()
      const displayText = decodeHtmlEntities(
        (match[2] ?? '').replace(/<[^>]+>/g, ''),
      ).trim()
      if (href) pairs.push({ href, displayText })
    }
  }

  const warnings: LinkWarning[] = []
  for (const { href, displayText } of pairs) {
    if (!href) continue
    // eslint-disable-next-line no-control-regex
    const normalized = href.replace(/[\u0000-\u0020]+/g, '')
    if (/^(?:javascript|data|vbscript|file):/i.test(normalized)) {
      warnings.push({ displayText, href, reason: 'suspicious-scheme' })
      continue
    }
    const candidate = /^[/\\]{2}/.test(normalized)
      ? `https://${normalized.replace(/^[/\\]+/, '')}`
      : normalized
    if (!/^https?:\/\//i.test(candidate)) continue
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      continue
    }
    if (parsed.username || parsed.password) {
      warnings.push({ displayText, href, reason: 'domain-mismatch' })
      continue
    }
    const host = parsed.hostname.toLowerCase()
    if (host.includes('xn--')) {
      warnings.push({ displayText, href, reason: 'punycode' })
      continue
    }
    if (isIpLiteral(host)) {
      warnings.push({ displayText, href, reason: 'ip-literal' })
      continue
    }
    const textHost = extractDomainFromDisplayText(displayText)
    if (textHost && registrableDomain(textHost) !== registrableDomain(host)) {
      warnings.push({ displayText, href, reason: 'domain-mismatch' })
    }
  }
  return warnings
}

const SENSITIVE_HEADER_PATTERN =
  /(?:cookie|auth|token|secret|api[-_]?key|session|credential|password)/i
const MAX_SINGLE_HEADER_VALUE_CHARS = 1024
const MAX_RAW_HEADERS_TOTAL_BYTES = 16 * 1024

export function sanitizeRawHeaders(
  headers: ReadonlyArray<{ name: string; value: string }> | undefined,
  maxHeaders = 60,
): Array<{ name: string; value: string }> {
  if (!headers?.length) return []
  const out: Array<{ name: string; value: string }> = []
  let totalBytes = 0
  for (const header of headers) {
    const name = (header.name ?? '').trim()
    if (!name || SENSITIVE_HEADER_PATTERN.test(name)) continue
    const rawValue = header.value ?? ''
    const value =
      rawValue.length > MAX_SINGLE_HEADER_VALUE_CHARS
        ? `${rawValue.slice(0, MAX_SINGLE_HEADER_VALUE_CHARS)}…`
        : rawValue
    const entryBytes = name.length + value.length + 4
    if (totalBytes + entryBytes > MAX_RAW_HEADERS_TOTAL_BYTES) break
    out.push({ name, value })
    totalBytes += entryBytes
    if (out.length >= maxHeaders) break
  }
  return out
}

export function parseMessageImportance(
  importanceHeader?: string,
  xPriorityHeader?: string,
): 'low' | 'normal' | 'high' | undefined {
  const imp = (importanceHeader ?? '').trim().toLowerCase()
  if (imp === 'high' || imp === 'urgent') return 'high'
  if (imp === 'low' || imp === 'non-urgent') return 'low'
  if (imp === 'normal') return 'normal'

  const xp = (xPriorityHeader ?? '').trim().toLowerCase()
  if (!xp) return undefined
  if (/^[12]\b/.test(xp) || xp.includes('high')) return 'high'
  if (/^[45]\b/.test(xp) || xp.includes('low')) return 'low'
  if (/^3\b/.test(xp) || xp.includes('normal')) return 'normal'
  return undefined
}

function headerValueFromRaw(
  rawHeaders: MailMessage['rawHeaders'],
  name: string,
): string | undefined {
  if (!rawHeaders?.length) return undefined
  const lowered = name.toLowerCase()
  return rawHeaders.find(h => h.name.toLowerCase() === lowered)?.value
}

export function inspectMailPrivacy(
  message: MailMessage,
  html?: string,
): MailPrivacyReport {
  const effectiveHtml = html ?? message.bodyHtml ?? ''
  const { trackers } = stripTrackingPixels(effectiveHtml)
  const linkWarnings = inspectAnchors(effectiveHtml)

  const auth: MailAuthResults =
    message.authResults ??
    parseAuthenticationResults(
      headerValueFromRaw(message.rawHeaders, 'Authentication-Results'),
      headerValueFromRaw(message.rawHeaders, 'Received-SPF'),
      headerValueFromRaw(message.rawHeaders, 'DKIM-Signature'),
    )

  const fromDomain = emailDomain(message.from?.email)
  let senderMismatch: MailPrivacyReport['senderMismatch'] = null
  if (fromDomain) {
    const fromRoot = registrableDomain(fromDomain)
    const replyToDomain = emailDomain(message.replyTo?.[0]?.email)
    if (replyToDomain && registrableDomain(replyToDomain) !== fromRoot) {
      senderMismatch = { fromDomain, replyOrReturnDomain: replyToDomain }
    } else {
      const returnDomain = emailDomain(
        message.returnPath ?? headerValueFromRaw(message.rawHeaders, 'Return-Path'),
      )
      if (returnDomain) {
        const returnRoot = registrableDomain(returnDomain)
        if (returnRoot !== fromRoot && !isTrustedBounceDomain(returnDomain)) {
          senderMismatch = { fromDomain, replyOrReturnDomain: returnDomain }
        }
      }
    }
  }

  return {
    trackers,
    linkWarnings,
    senderMismatch,
    auth,
  }
}
