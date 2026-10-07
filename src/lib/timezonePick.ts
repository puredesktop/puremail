/**
 * Choosing a timezone for a time in an email: the zones a person can pick
 * from (every IANA zone the runtime knows, searched by city, region, country
 * and the usual abbreviations), and a guess at the zone a time was written
 * in, from the words around it ("2pm UK", "9am Eastern", "CET") and, failing
 * those, from the words anywhere in the email.
 */

export interface ZoneChoice {
  /** The IANA zone. */
  zone: string
  /** As a person reads it: "London (Europe)". */
  label: string
  /** Words that find it besides its own name. */
  aliases: string[]
}

/** What people write, and the zone they mean. The first zone of a word is the usual one; a word with several meanings keeps the usual and lists the rest. */
const ALIASES: Array<[string[], string]> = [
  [['uk', 'u.k.', 'britain', 'british', 'england', 'scotland', 'wales', 'gmt', 'bst', 'london'], 'Europe/London'],
  [['ireland', 'irish', 'dublin'], 'Europe/Dublin'],
  [['cet', 'cest', 'central european', 'germany', 'german', 'berlin', 'frankfurt', 'munich'], 'Europe/Berlin'],
  [['france', 'french', 'paris'], 'Europe/Paris'],
  [['netherlands', 'dutch', 'amsterdam', 'holland'], 'Europe/Amsterdam'],
  [['spain', 'spanish', 'madrid', 'barcelona'], 'Europe/Madrid'],
  [['italy', 'italian', 'rome', 'milan'], 'Europe/Rome'],
  [['switzerland', 'swiss', 'zurich', 'geneva'], 'Europe/Zurich'],
  [['belgium', 'brussels'], 'Europe/Brussels'],
  [['austria', 'vienna'], 'Europe/Vienna'],
  [['sweden', 'swedish', 'stockholm'], 'Europe/Stockholm'],
  [['norway', 'oslo'], 'Europe/Oslo'],
  [['denmark', 'danish', 'copenhagen'], 'Europe/Copenhagen'],
  [['finland', 'finnish', 'helsinki', 'eet', 'eest'], 'Europe/Helsinki'],
  [['poland', 'polish', 'warsaw'], 'Europe/Warsaw'],
  [['portugal', 'portuguese', 'lisbon', 'wet', 'west'], 'Europe/Lisbon'],
  [['greece', 'athens'], 'Europe/Athens'],
  [['turkey', 'istanbul'], 'Europe/Istanbul'],
  [['moscow', 'msk', 'russia'], 'Europe/Moscow'],
  [['israel', 'tel aviv', 'jerusalem', 'idt'], 'Asia/Jerusalem'],
  [['uae', 'dubai', 'abu dhabi', 'gst'], 'Asia/Dubai'],
  [['india', 'indian', 'ist', 'delhi', 'mumbai', 'bangalore', 'bengaluru', 'kolkata', 'chennai', 'hyderabad'], 'Asia/Kolkata'],
  [['pakistan', 'karachi', 'pkt'], 'Asia/Karachi'],
  [['bangladesh', 'dhaka'], 'Asia/Dhaka'],
  [['singapore', 'sgt'], 'Asia/Singapore'],
  [['malaysia', 'kuala lumpur'], 'Asia/Kuala_Lumpur'],
  [['hong kong', 'hkt'], 'Asia/Hong_Kong'],
  [['china', 'chinese', 'beijing', 'shanghai'], 'Asia/Shanghai'],
  [['taiwan', 'taipei'], 'Asia/Taipei'],
  [['japan', 'japanese', 'jst', 'tokyo', 'osaka'], 'Asia/Tokyo'],
  [['korea', 'korean', 'kst', 'seoul'], 'Asia/Seoul'],
  [['thailand', 'bangkok', 'ict'], 'Asia/Bangkok'],
  [['vietnam', 'hanoi', 'ho chi minh'], 'Asia/Ho_Chi_Minh'],
  [['indonesia', 'jakarta', 'wib'], 'Asia/Jakarta'],
  [['philippines', 'manila', 'pht'], 'Asia/Manila'],
  [['sydney', 'melbourne', 'canberra', 'aest', 'aedt', 'australia', 'australian'], 'Australia/Sydney'],
  [['brisbane', 'queensland'], 'Australia/Brisbane'],
  [['adelaide', 'acst', 'acdt'], 'Australia/Adelaide'],
  [['perth', 'awst'], 'Australia/Perth'],
  [['new zealand', 'nz', 'nzst', 'nzdt', 'auckland', 'wellington', 'aotearoa'], 'Pacific/Auckland'],
  [['eastern', 'et', 'est', 'edt', 'new york', 'nyc', 'boston', 'washington', 'dc', 'toronto', 'miami', 'atlanta'], 'America/New_York'],
  [['central', 'ct', 'cst', 'cdt', 'chicago', 'dallas', 'houston', 'austin', 'minneapolis'], 'America/Chicago'],
  [['mountain', 'mt', 'mst', 'mdt', 'denver', 'salt lake'], 'America/Denver'],
  [['arizona', 'phoenix'], 'America/Phoenix'],
  [['pacific', 'pt', 'pst', 'pdt', 'los angeles', 'la', 'san francisco', 'sf', 'seattle', 'portland', 'california', 'vancouver'], 'America/Los_Angeles'],
  [['alaska', 'akst', 'akdt', 'anchorage'], 'America/Anchorage'],
  [['hawaii', 'hst', 'honolulu'], 'Pacific/Honolulu'],
  [['montreal', 'ottawa', 'quebec'], 'America/Toronto'],
  [['mexico', 'mexico city', 'cdmx'], 'America/Mexico_City'],
  [['brazil', 'brazilian', 'são paulo', 'sao paulo', 'brt'], 'America/Sao_Paulo'],
  [['argentina', 'buenos aires', 'art'], 'America/Argentina/Buenos_Aires'],
  [['chile', 'santiago'], 'America/Santiago'],
  [['colombia', 'bogota', 'bogotá'], 'America/Bogota'],
  [['peru', 'lima'], 'America/Lima'],
  [['south africa', 'johannesburg', 'cape town', 'sast'], 'Africa/Johannesburg'],
  [['nigeria', 'lagos', 'wat'], 'Africa/Lagos'],
  [['kenya', 'nairobi', 'eat'], 'Africa/Nairobi'],
  [['egypt', 'cairo'], 'Africa/Cairo'],
  [['morocco', 'casablanca'], 'Africa/Casablanca'],
  [['utc', 'z', 'zulu', 'coordinated universal'], 'UTC'],
]

/** Abbreviations and words with more than one meaning: the guess says so. */
const AMBIGUOUS = new Set(['ist', 'cst', 'ct', 'est', 'et', 'pt', 'mt', 'central', 'eastern', 'pacific', 'mountain', 'bst', 'gst', 'art', 'wat', 'eat', 'west', 'la', 'dc', 'sf'])

const aliasesOf = new Map<string, string[]>()
for (const [words, zone] of ALIASES) aliasesOf.set(zone, [...(aliasesOf.get(zone) ?? []), ...words])

const cityOf = (zone: string) => (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
const regionOf = (zone: string) => zone.includes('/') ? zone.slice(0, zone.indexOf('/')).replace(/_/g, ' ') : ''

/** Every zone the runtime knows (the usual ones first when it knows none), as choices. */
export function zoneChoices(known: readonly string[] = supportedZones()): ZoneChoice[] {
  const list = known.length ? [...known] : ALIASES.map(([, z]) => z)
  const seen = new Set<string>()
  const out: ZoneChoice[] = []
  for (const zone of [...list, ...ALIASES.map(([, z]) => z)]) {
    if (seen.has(zone)) continue
    seen.add(zone)
    const region = regionOf(zone)
    out.push({ zone, label: region ? `${cityOf(zone)} (${region})` : zone, aliases: aliasesOf.get(zone) ?? [] })
  }
  return out
}

function supportedZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : []
  } catch { return [] }
}

/** The choices that match what was typed, the best first: an alias or a city that starts with it, then any that contains it. At most `limit`. */
export function searchZones(choices: readonly ZoneChoice[], typed: string, limit = 8): ZoneChoice[] {
  const q = typed.trim().toLowerCase().replace(/_/g, ' ')
  if (!q) return []
  const score = (c: ZoneChoice): number => {
    const city = cityOf(c.zone).toLowerCase()
    const id = c.zone.toLowerCase().replace(/_/g, ' ')
    if (c.aliases.includes(q)) return 0
    if (city === q || id === q) return 1
    if (c.aliases.some(a => a.startsWith(q))) return 2
    if (city.startsWith(q)) return 3
    if (id.startsWith(q)) return 4
    if (c.aliases.some(a => a.includes(q))) return 5
    if (id.includes(q) || c.label.toLowerCase().includes(q)) return 6
    return -1
  }
  // Among equal matches, the one whose matching word is shortest (closest to what was typed) comes first.
  const closeness = (c: ZoneChoice) => Math.min(...[cityOf(c.zone), ...c.aliases].map(w => w.toLowerCase()).filter(w => w.startsWith(q) || w.includes(q)).map(w => w.length), 99)
  return choices.map(c => ({ c, s: score(c), n: closeness(c) })).filter(x => x.s >= 0).sort((a, b) => a.s - b.s || a.n - b.n || a.c.zone.localeCompare(b.c.zone)).slice(0, limit).map(x => x.c)
}

export interface ZoneGuess {
  zone: string
  /** The word it was guessed from. */
  from: string
  /** The word has other meanings too: worth checking. */
  ambiguous: boolean
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WORD_PATTERNS: Array<{ re: RegExp; word: string; zone: string }> = ALIASES.flatMap(([words, zone]) =>
  words.filter(w => w.length > 1 || w === 'z').map(word => ({ word, zone, re: new RegExp(`(?<![a-z])${esc(word)}(?![a-z])`, 'i') })))

/** The zone a run of text names, if it names one: the longest matching word wins, so "new york" beats "york" and "south africa" beats "africa". */
export function zoneNamedIn(text: string): ZoneGuess | null {
  const lower = text.toLowerCase()
  let best: { word: string; zone: string; at: number } | null = null
  for (const p of WORD_PATTERNS) {
    const m = p.re.exec(lower)
    if (!m) continue
    // A one- or two-letter word (z, la, et) only counts beside a time, where it is a zone and not a word.
    if (p.word.length <= 2 && !/\d\s*(am|pm)?\s*$/.test(lower.slice(0, m.index).trimEnd()) && !/^\s*(time|zone)/.test(lower.slice(m.index + p.word.length))) continue
    if (!best || p.word.length > best.word.length || (p.word.length === best.word.length && m.index < best.at)) best = { word: m[0], zone: p.zone, at: m.index }
  }
  return best ? { zone: best.zone, from: best.word, ambiguous: AMBIGUOUS.has(best.word.toLowerCase()) } : null
}

/**
 * The zone a time was written in: named in the mention itself, or in its
 * sentence; else named anywhere in the email (the sender's "2pm UK" in one
 * line stands for the times in the others). Null when nothing is named.
 */
export function guessZone(email: string, mention: { text: string; index: number }): ZoneGuess | null {
  const own = zoneNamedIn(mention.text)
  if (own) return own
  const start = Math.max(0, email.lastIndexOf('\n', mention.index), email.lastIndexOf('. ', mention.index))
  const stop = [email.indexOf('\n', mention.index + mention.text.length), email.indexOf('. ', mention.index + mention.text.length)].filter(i => i >= 0)
  const sentence = email.slice(start, stop.length ? Math.min(...stop) + 1 : undefined)
  const near = zoneNamedIn(sentence)
  if (near) return near
  return zoneNamedIn(email)
}
