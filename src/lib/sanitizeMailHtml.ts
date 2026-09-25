import { blockRemoteImagesInMailHtml } from './mailModel'

/**
 * Render-time sanitizer for mail `bodyHtml` (M2). Runs immediately before
 * `dangerouslySetInnerHTML`; the STORED bodyHtml stays raw so future
 * renderers keep full fidelity.
 *
 * This is a strict DOM-based allowlist walker rather than DOMPurify:
 * DOMPurify silently misbehaves under happy-dom (it keeps `<script>` and
 * drops allowlisted elements), which made the sanitizer untestable — and an
 * untested sanitizer is the one thing this module must not be. The walker
 * behaves identically in the browser and in tests.
 *
 * Posture: render what the sender designed, minus anything that can lie
 * about origin or phone home — the same trade Gmail/Proton/Apple Mail make.
 * Real email is table layout (Google Docs notifications, GitHub, receipts,
 * newsletters): spacer cells, cellpadding button tables, bgcolor bands.
 * Stripping those doesn't just lose polish, it produces WRONG rendering —
 * avatar cells jammed into names, adjacent button links fused together.
 *
 * Policy:
 * - Only allowlisted formatting/table tags survive. Actively dangerous
 *   elements (script/style/iframe/object/embed/form controls/base/svg/math
 *   and the classic mXSS carriers noscript/template/title/textarea/xmp/
 *   noembed/noframes) are removed WITH their content; anything else unknown
 *   is unwrapped so its text survives. Comments are dropped (conditional
 *   comments are an mXSS vector).
 * - Embedded `<style>` sheets survive FILTERED AND SCOPED, the way Gmail
 *   keeps them. Real newsletters are mobile-first hybrids: the columns are
 *   stacked full-width inline-blocks by default, un-stacked into desktop
 *   columns by `!important` rules inside a `min-width` media query in
 *   `<head><style>`. Drop the style block and every newsletter renders as
 *   its phone fallback in a desktop-width pane. The pipeline in
 *   `filterMessageStyleSheet` keeps only style rules whose declarations
 *   pass the same closed per-property filter as inline `style` (with
 *   `!important` preserved — it is what lets the media-query rules beat the
 *   mobile inline styles), and only `@media` rules with screen/width-type
 *   conditions. Selectors are a CLOSED grammar (allowlisted element names,
 *   .classes, #ids, descendant/child combinators, comma lists — nothing
 *   else), every class/id is renamed into the `pm-c-`/`pm-i-` namespace,
 *   and every selector is prefixed with a unique per-message scope class,
 *   so no rule can ever match outside its own message container.
 * - Only allowlisted attributes survive; every `on*` handler is dropped.
 *   Table layout attributes (width/height/align/valign/bgcolor/cellpadding/
 *   cellspacing/border) survive on table/tr/td/th when their values match
 *   closed patterns — invalid values drop the attribute, never pass through.
 * - Inline `style` survives as an email-grade but CLOSED per-property
 *   allowlist: spacing (non-negative margins only), sizing, borders,
 *   colors, typography, table plumbing, in-flow display/float. Everything
 *   that can take content OUT of flow or paint over the app stays banned:
 *   position/inset/z-index/transform/filter/opacity/visibility/
 *   pointer-events/content, and negative margins. Every declaration value
 *   is globally rejected if it references url()/expression()/image-set()/
 *   var()/attr() or CSS escapes, so no allowlisted property can ever fetch
 *   anything — sender styling cannot phone home.
 * - `href` must be http/https/mailto; `src` must be http/https/cid or an
 *   embedded `data:image/*`. `javascript:` and `data:text/html` URLs never
 *   survive, including control-character obfuscations.
 * - Links get `target="_blank"` + `rel="noopener noreferrer"`.
 * - Remote images (tracking pixels, read receipts) are blocked by default
 *   and only load after an explicit per-message "Load images".
 */

const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'caption',
  'center',
  'code',
  'col',
  'colgroup',
  'div',
  'em',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'video',
  'audio',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])

/**
 * Removed together with their content. Everything else outside the
 * allowlist is merely unwrapped. `textarea`, `title`, `noscript`, `xmp`,
 * `noembed`, `noframes`, `template` and `plaintext` are raw-text/content
 * switching elements whose bodies mutate on reparse (mXSS), so their
 * content must not leak out either.
 */
const REMOVE_WITH_CONTENT_TAGS = new Set([
  'applet',
  'base',
  'button',
  'dialog',
  'embed',
  'form',
  'frame',
  'frameset',
  'head',
  'iframe',
  'input',
  'link',
  'math',
  'meta',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'plaintext',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
  'title',
  'xmp',
])

/* ── Shared value grammars (style properties + presentational attrs) ──
 *
 * Regex source fragments, composed into anchored per-property patterns.
 * Everything here is CLOSED: a value either matches a full grammar or the
 * declaration/attribute is dropped. Nothing is ever passed through on the
 * grounds of "looks harmless".
 */

/** Non-negative CSS length: 0 | Npx | Npt | Nem | N%. */
const LEN = String.raw`(?:0|\d{1,4}(?:\.\d{1,3})?(?:px|pt|em|%))`
const LEN_OR_AUTO = String.raw`(?:${LEN}|auto)`

/**
 * Color: #hex (3/4/6/8), rgb()/rgba() with numeric args, or a fixed set of
 * CSS named colors. No hsl/lab/color(): senders don't use them and every
 * form we don't parse is a form we can't audit. Comma-separated function
 * args are matched space-free — style values have their commas tightened
 * during normalization, attribute values are tested whitespace-stripped.
 */
const NAMED_COLORS =
  'aqua|black|blue|brown|cyan|fuchsia|gold|gray|green|grey|lime|magenta|maroon|navy|olive|orange|pink|purple|red|silver|teal|transparent|white|yellow'
const COLOR = String.raw`(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgb\(\d{1,3}%?,\d{1,3}%?,\d{1,3}%?\)|rgba\(\d{1,3}%?,\d{1,3}%?,\d{1,3}%?,(?:0|1|[01]?\.\d{1,4})\)|(?:${NAMED_COLORS}))`

const BORDER_STYLE = '(?:none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)'
const BORDER_WIDTH = String.raw`(?:${LEN}|thin|medium|thick)`
const BORDER_TOKEN = String.raw`(?:${BORDER_WIDTH}|${BORDER_STYLE}|${COLOR})`

/** Anchor a fragment into a full-value pattern. */
const full = (body: string): RegExp => new RegExp(`^${body}$`)
/** 1–4 space-separated tokens (CSS shorthand sides). */
const sides = (token: string): RegExp => full(`${token}(?: ${token}){0,3}`)

const GLOBAL_ALLOWED_ATTRS = new Set(['title'])

/**
 * Globally allowed attributes that carry a value grammar: an invalid value
 * drops the attribute. `dir`/`lang` matter for RTL and hyphenation;
 * `class`/`id` are what the scoped `<style>` selectors match on — their
 * tokens are validated AND renamed into a private namespace (`pm-c-`/
 * `pm-i-`), so sender markup can never collide with the app's own class
 * names or clobber `window` properties via `id`, and the filtered CSS
 * (whose selectors get the same renaming) still finds them.
 */
const GLOBAL_ATTR_PATTERNS: Record<string, RegExp> = {
  dir: /^(?:ltr|rtl|auto)$/i,
  lang: /^[a-z]{1,8}(?:-[a-z0-9]{1,8}){0,3}$/i,
}

/** One CSS class or id token, as senders actually write them. */
const NAME_TOKEN = /^-?[A-Za-z_][A-Za-z0-9_-]{0,63}$/
/** Namespace prefixes for sender class/id names (markup AND selectors). */
const CONTENT_CLASS_PREFIX = 'pm-c-'
const CONTENT_ID_PREFIX = 'pm-i-'

/** Validate + rename a class attribute's tokens; '' when nothing survives. */
function rewriteClassAttribute(rawValue: string): string {
  return rawValue
    .split(/\s+/)
    .filter(token => NAME_TOKEN.test(token))
    .map(token => CONTENT_CLASS_PREFIX + token)
    .join(' ')
}

/**
 * Presentational table attributes — the layout language most real mail is
 * written in (spacer cells with widths, cellpadding button tables, bgcolor
 * bands). Each one is validated against a closed pattern below; an invalid
 * value drops the attribute rather than passing through.
 */
const TABLE_LAYOUT_ATTRS = ['width', 'height', 'align', 'valign', 'bgcolor']

const PER_TAG_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  // width/height are kept so the browser can reserve space for an image
  // before it loads. Without them the message reflows as each image
  // arrives, and a reader scrolling through a picture-heavy mail gets
  // yanked up and down. The CSS still caps rendered size
  // (`max-width: 100%; height: auto`), so these only supply the aspect
  // ratio — they cannot make an image overflow the pane.
  img: new Set(['src', 'alt', 'width', 'height']),
  video: new Set(['src', 'controls', 'preload', 'width', 'height']),
  audio: new Set(['src', 'controls', 'preload']),
  table: new Set([
    ...TABLE_LAYOUT_ATTRS,
    'cellpadding',
    'cellspacing',
    'border',
  ]),
  tr: new Set(TABLE_LAYOUT_ATTRS),
  td: new Set(['colspan', 'rowspan', ...TABLE_LAYOUT_ATTRS]),
  th: new Set(['colspan', 'rowspan', ...TABLE_LAYOUT_ATTRS]),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  // Legacy but alive in newsletter markup. Kept as the tag itself: the
  // browser's presentational hints give color/size/face their meaning.
  font: new Set(['color', 'size', 'face']),
}

/**
 * Closed value patterns for `<font>`: color is the shared color grammar
 * (tested whitespace-stripped, like bgcolor), size the legacy 1–7 scale
 * with relative +/- forms, face the same closed charset as font-family.
 */
const FONT_ATTR_PATTERNS: Record<string, RegExp> = {
  color: new RegExp(`^${COLOR}$`, 'i'),
  size: /^[+-]?[1-7]$/,
  face: /^[a-z0-9,'" -]{1,120}$/i,
}

/**
 * Closed value patterns for the table layout attributes. Tested against the
 * trimmed value (bgcolor additionally with internal whitespace removed so
 * `rgb(1, 2, 3)` normalizes); a non-match removes the attribute.
 */
const TABLE_ATTR_PATTERNS: Record<string, RegExp> = {
  width: /^\d{1,5}(?:%|px)?$/,
  height: /^\d{1,5}(?:%|px)?$/,
  align: /^(?:left|right|center|justify)$/i,
  valign: /^(?:top|middle|bottom|baseline)$/i,
  cellpadding: /^\d{1,3}$/,
  cellspacing: /^\d{1,3}$/,
  border: /^\d{1,3}$/,
  bgcolor: new RegExp(`^${COLOR}$`, 'i'),
}

const TABLE_ATTR_TAGS = new Set(['table', 'tr', 'td', 'th'])

const HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
const SRC_SCHEMES = new Set(['http:', 'https:', 'cid:'])

/**
 * Scheme of a URL attribute value, normalized the way the HTML spec does
 * before navigation: leading control/space characters and embedded tab/
 * newline/carriage-return characters are ignored, so `java\tscript:` IS the
 * javascript scheme. Returns null for scheme-less (relative) URLs.
 */
function urlScheme(rawValue: string): string | null {
  // eslint-disable-next-line no-control-regex
  const compact = rawValue.replace(/[\u0000-\u0020]/g, '').toLowerCase()
  const match = compact.match(/^([a-z][a-z0-9+.-]*:)/)
  return match ? match[1]! : null
}

function isAllowedHref(value: string): boolean {
  const scheme = urlScheme(value)
  return scheme !== null && HREF_SCHEMES.has(scheme)
}

function isAllowedSrc(value: string): boolean {
  const scheme = urlScheme(value)
  if (scheme === null) return false
  if (SRC_SCHEMES.has(scheme)) return true
  if (scheme === 'data:') {
    // eslint-disable-next-line no-control-regex
    return /^data:image\//i.test(value.replace(/[\u0000-\u0020]/g, ''))
  }
  return false
}

/**
 * A dimension the browser can use to reserve layout space: a bare number
 * of CSS pixels. Percentages, `auto`, and unit suffixes carry no aspect
 * ratio, and anything else is junk — all dropped rather than trusted.
 */
function isLayoutDimension(value: string): boolean {
  return /^\d{1,5}$/.test(value.trim())
}

/**
 * Inline style survives as an email-grade but CLOSED per-property allowlist.
 * Every property here keeps content IN normal flow on the light message
 * paper: spacing, sizing, borders, color, typography, table plumbing. What
 * stays banned — permanently, never to be allowlisted — is everything that
 * could take content out of flow or paint over the app's own UI:
 * position/top/right/bottom/left/inset, z-index, transform, filter,
 * pointer-events, content, visibility, opacity (invisible-overlay vector),
 * negative margins (same, via overlap), and the `background`/
 * `background-image` shorthands (they can carry url()). Values are matched
 * against closed per-property grammars; anything else, including any
 * property not listed, is dropped.
 */
const ALLOWED_STYLE_PROPS: Record<string, RegExp> = {
  // Spacing. Margins are non-negative only: a negative margin pulls content
  // over its neighbours, which is an overlay/spoofing vector.
  padding: sides(LEN),
  'padding-top': full(LEN),
  'padding-right': full(LEN),
  'padding-bottom': full(LEN),
  'padding-left': full(LEN),
  margin: sides(LEN_OR_AUTO),
  'margin-top': full(LEN_OR_AUTO),
  'margin-right': full(LEN_OR_AUTO),
  'margin-bottom': full(LEN_OR_AUTO),
  'margin-left': full(LEN_OR_AUTO),
  // Sizing.
  width: full(LEN_OR_AUTO),
  'min-width': full(LEN),
  'max-width': full(`(?:${LEN}|none)`),
  height: full(LEN_OR_AUTO),
  'min-height': full(LEN),
  'max-height': full(`(?:${LEN}|none)`),
  'line-height': full(String.raw`(?:normal|\d{1,3}(?:\.\d{1,3})?|${LEN})`),
  'vertical-align':
    /^(?:top|middle|bottom|baseline|text-top|text-bottom|sub|super)$/,
  // Borders.
  border: full(`(?:none|${BORDER_TOKEN}(?: ${BORDER_TOKEN}){0,2})`),
  'border-top': full(`(?:none|${BORDER_TOKEN}(?: ${BORDER_TOKEN}){0,2})`),
  'border-right': full(`(?:none|${BORDER_TOKEN}(?: ${BORDER_TOKEN}){0,2})`),
  'border-bottom': full(`(?:none|${BORDER_TOKEN}(?: ${BORDER_TOKEN}){0,2})`),
  'border-left': full(`(?:none|${BORDER_TOKEN}(?: ${BORDER_TOKEN}){0,2})`),
  'border-width': sides(BORDER_WIDTH),
  'border-style': sides(BORDER_STYLE),
  'border-color': sides(COLOR),
  'border-top-width': full(BORDER_WIDTH),
  'border-right-width': full(BORDER_WIDTH),
  'border-bottom-width': full(BORDER_WIDTH),
  'border-left-width': full(BORDER_WIDTH),
  'border-top-style': full(BORDER_STYLE),
  'border-right-style': full(BORDER_STYLE),
  'border-bottom-style': full(BORDER_STYLE),
  'border-left-style': full(BORDER_STYLE),
  'border-top-color': full(COLOR),
  'border-right-color': full(COLOR),
  'border-bottom-color': full(COLOR),
  'border-left-color': full(COLOR),
  'border-radius': sides(LEN),
  'border-collapse': /^(?:collapse|separate)$/,
  'border-spacing': full(`${LEN}(?: ${LEN})?`),
  // Color. The `background` shorthand survives ONLY when its entire value
  // is a single color — senders write `background:#fff` constantly. Any
  // other shorthand payload (url(), gradients, positions) fails the
  // grammar and the declaration is dropped whole.
  background: full(COLOR),
  'background-color': full(COLOR),
  color: full(COLOR),
  // Typography. font-size is validated by isAllowedFontSize (clamped).
  'font-family': /^[a-z0-9,'" -]{1,120}$/,
  'font-weight': /^(?:normal|bold|bolder|lighter|[1-9]00)$/,
  'font-style': /^(?:normal|italic|oblique)$/,
  'text-decoration':
    /^(?:none|(?:underline|line-through)(?: (?:underline|line-through))?)$/,
  'text-decoration-line':
    /^(?:none|(?:underline|line-through)(?: (?:underline|line-through))?)$/,
  'text-align': /^(?:left|right|center|justify)$/,
  'text-transform': /^(?:none|uppercase|lowercase|capitalize)$/,
  'letter-spacing': full(`(?:normal|-?${LEN})`),
  'word-spacing': full(`(?:normal|-?${LEN})`),
  'white-space': /^(?:normal|nowrap|pre|pre-wrap|pre-line)$/,
  'word-break': /^(?:normal|break-all|keep-all|break-word)$/,
  // In-flow layout only. display:none is legitimate email idiom (preheader
  // text); no positioned/out-of-flow display values exist to allow.
  // inline-table is how newsletters sit two tables side by side (footer
  // social rows, MJML groups) — still fully in flow.
  display:
    /^(?:block|inline|inline-block|table|inline-table|table-row|table-cell|none)$/,
  float: /^(?:left|right|none)$/,
  clear: /^(?:left|right|both|none)$/,
  // overflow:hidden is the other half of the max-height:0 preheader-hiding
  // idiom; without it the clipped text paints over the message below.
  // Clipping can only ever hide the sender's own box, never overlay ours.
  overflow: /^(?:visible|hidden|auto)$/,
  direction: /^(?:ltr|rtl)$/,
  'list-style-type':
    /^(?:none|disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman)$/,
  // Table plumbing.
  'table-layout': /^(?:auto|fixed)$/,
  'box-sizing': /^(?:border-box|content-box)$/,
}

/**
 * Global rejection, applied to EVERY declaration value before any
 * per-property check: nothing that references another resource or escapes
 * the closed grammars may survive, on any property, ever. This is the
 * load-bearing guarantee that the widened style set cannot phone home —
 * url() is how CSS fetches. Backslashes (CSS escapes like `u\72 l(`),
 * comments, and structural characters are rejected outright rather than
 * decoded.
 */
const HOSTILE_STYLE_VALUE =
  /(?:url|expression|image-set|var|attr)\s*\(|[\\<>@{}]|\/\*/

/**
 * font-size, clamped: a sender may set type, not fill the viewport with a
 * single letter (a classic fake-UI trick). px caps at 96, pt at 72, and the
 * relative units at the equivalent scale.
 */
const FONT_SIZE_VALUE = /^(\d{1,3}(?:\.\d{1,3})?)(px|pt|em|%)?$/
const FONT_SIZE_MAX: Record<string, number> = { px: 96, pt: 72, em: 6, '%': 600 }

function isAllowedFontSize(value: string): boolean {
  const match = FONT_SIZE_VALUE.exec(value)
  if (!match) return false
  const size = Number(match[1])
  const unit = match[2]
  if (!unit) return size === 0
  return size <= FONT_SIZE_MAX[unit]!
}

/**
 * THE style filter — the one implementation both style surfaces go through.
 * Inline `style` attributes drop `!important` (inside a message body the
 * priority is moot); `<style>` block rules KEEP it, because it is exactly
 * what lets a media-query rule out-prioritize the mobile-first inline
 * styles — lose it and every hybrid newsletter stays stacked.
 */
function filterStyleDeclarations(
  rawValue: string,
  { keepImportant }: { keepImportant: boolean },
): string {
  const kept: string[] = []
  for (const declaration of rawValue.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const normalized = declaration
      .slice(colon + 1)
      .trim()
      .toLowerCase()
      // Normalize so the closed grammars can be whitespace-exact: collapse
      // runs and tighten around commas (`rgb(1, 2, 3)` → `rgb(1,2,3)`).
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ',')
    const value = normalized.replace(/\s*!\s*important$/, '')
    const suffix =
      keepImportant && value !== normalized ? ' !important' : ''
    if (HOSTILE_STYLE_VALUE.test(value)) continue
    if (property === 'font-size') {
      if (isAllowedFontSize(value)) kept.push(`${property}: ${value}${suffix}`)
      continue
    }
    const pattern = ALLOWED_STYLE_PROPS[property]
    if (pattern && pattern.test(value)) {
      kept.push(`${property}: ${value}${suffix}`)
    }
  }
  return kept.join('; ')
}

function filterInlineStyle(rawValue: string): string {
  return filterStyleDeclarations(rawValue, { keepImportant: false })
}

/* ── Embedded <style> sheets: filtered, scoped, re-emitted ──
 *
 * A hand-rolled parser rather than CSSOM: the sanitizer's contract is that
 * it behaves identically in the browser and under happy-dom, and CSSOM
 * serialization differs between engines (shorthand expansion, value
 * normalization). The grammar here is closed and small, so parsing it by
 * hand is the auditable option. Everything unrecognized is dropped —
 * @import/@font-face/@keyframes/@supports, selectors outside the grammar,
 * declarations outside the shared per-property allowlist. On any parse
 * desync (unbalanced braces, quotes) the remainder of the sheet is
 * discarded: this parser can only ever over-drop, never pass through.
 */

/** Per-sheet size cap: past this a "sheet" is not a newsletter, drop it. */
const MAX_STYLE_SHEET_CHARS = 200_000

/**
 * Media conditions: screen/width-type only, tested against a normalized
 * (lowercased, whitespace-tightened) condition. Each comma-separated query
 * must be `only? screen|all` and/or `and`-chained width features. Anything
 * else (print, orientation, hover, vendor hacks) drops that query;
 * a condition with no surviving query drops the whole @media rule.
 */
const MEDIA_FEATURE = String.raw`\((?:min-|max-)?(?:device-)?width:\d{1,5}(?:\.\d{1,3})?(?:px|em|pt)\)`
const MEDIA_QUERY = new RegExp(
  `^(?:(?:only )?(?:all|screen)(?: and ${MEDIA_FEATURE})*|${MEDIA_FEATURE}(?: and ${MEDIA_FEATURE})*)$`,
)

function normalizeMediaCondition(raw: string): string {
  const queries = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s*:\s*/g, ':')
    .split(',')
    .map(query => query.trim())
    .filter(query => MEDIA_QUERY.test(query))
  return queries.join(', ')
}

/**
 * One compound selector: optional allowlisted element name, then any run of
 * `.class` / `#id` simple selectors — nothing else. `html`/`body`/`:root`
 * fall out naturally (not in ALLOWED_TAGS / `:` outside the grammar), as do
 * `*`, attribute selectors, and every pseudo-class/-element. Class and id
 * names are renamed into the same private namespace the markup rewriter
 * uses, so surviving selectors keep matching. Returns null to reject.
 */
function rewriteCompoundSelector(part: string): string | null {
  let out = ''
  let index = 0
  const tagMatch = /^[a-zA-Z][a-zA-Z0-9]*/.exec(part)
  if (tagMatch) {
    const tag = tagMatch[0].toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return null
    out += tag
    index = tagMatch[0].length
  }
  while (index < part.length) {
    const kind = part[index]
    if (kind !== '.' && kind !== '#') return null
    const name = /^-?[A-Za-z_][A-Za-z0-9_-]{0,63}/.exec(part.slice(index + 1))
    if (!name) return null
    out +=
      kind + (kind === '.' ? CONTENT_CLASS_PREFIX : CONTENT_ID_PREFIX) + name[0]
    index += 1 + name[0].length
  }
  return out === '' ? null : out
}

/**
 * A selector list: comma-separated selectors, each a chain of compounds
 * joined by descendant or `>` combinators. Selectors outside the grammar
 * are dropped individually; every survivor is prefixed with the message's
 * scope class so it cannot match outside its own container.
 */
function rewriteSelectorList(
  rawList: string,
  scopeClass: string,
): string {
  const kept: string[] = []
  for (const rawSelector of rawList.split(',')) {
    const selector = rawSelector
      .trim()
      .replace(/\s*>\s*/g, ' > ')
      .replace(/\s+/g, ' ')
    if (!selector) continue
    const parts = selector.split(' ')
    const rebuilt: string[] = []
    let expectCompound = true
    let valid = parts.length > 0
    for (const part of parts) {
      if (part === '>') {
        if (expectCompound) {
          valid = false
          break
        }
        rebuilt.push('>')
        expectCompound = true
        continue
      }
      const compound = rewriteCompoundSelector(part)
      if (compound === null) {
        valid = false
        break
      }
      rebuilt.push(compound)
      expectCompound = false
    }
    if (valid && !expectCompound) {
      kept.push(`.${scopeClass} ${rebuilt.join(' ')}`)
    }
  }
  return kept.join(', ')
}

/**
 * Index of the `}` matching the `{` at openIndex, skipping quoted spans.
 * -1 on imbalance — the caller stops parsing the sheet there.
 */
function matchingBrace(css: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < css.length; i++) {
    const ch = css[i]
    if (ch === '"' || ch === "'") {
      const close = css.indexOf(ch, i + 1)
      if (close === -1) return -1
      i = close
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function filterCssRules(
  css: string,
  scopeClass: string,
  allowMedia: boolean,
): string[] {
  const out: string[] = []
  let i = 0
  while (i < css.length) {
    const ch = css[i]!
    if (/[\s;]/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '@') {
      const braceIndex = css.indexOf('{', i)
      const semiIndex = css.indexOf(';', i)
      if (semiIndex !== -1 && (braceIndex === -1 || semiIndex < braceIndex)) {
        // Statement at-rule (@import, @charset, @namespace): dropped whole.
        i = semiIndex + 1
        continue
      }
      if (braceIndex === -1) break
      const end = matchingBrace(css, braceIndex)
      if (end === -1) break
      const name = /^@([a-z-]+)/i.exec(css.slice(i))?.[1]?.toLowerCase()
      if (allowMedia && name === 'media') {
        const condition = normalizeMediaCondition(
          css.slice(i + '@media'.length, braceIndex),
        )
        if (condition) {
          // No nested at-rules: inner content is style rules or nothing.
          const inner = filterCssRules(
            css.slice(braceIndex + 1, end),
            scopeClass,
            false,
          )
          if (inner.length > 0) {
            out.push(`@media ${condition} {\n${inner.join('\n')}\n}`)
          }
        }
      }
      // Every other block at-rule (@font-face, @keyframes, @supports, and
      // @media where disallowed or condition-rejected): dropped whole.
      i = end + 1
      continue
    }
    const braceIndex = css.indexOf('{', i)
    if (braceIndex === -1) break
    const end = matchingBrace(css, braceIndex)
    if (end === -1) break
    const selectors = rewriteSelectorList(css.slice(i, braceIndex), scopeClass)
    if (selectors) {
      const declarations = filterStyleDeclarations(
        css.slice(braceIndex + 1, end),
        { keepImportant: true },
      )
      if (declarations) out.push(`${selectors} { ${declarations}; }`)
    }
    i = end + 1
  }
  return out
}

function filterMessageStyleSheet(cssText: string, scopeClass: string): string {
  if (cssText.length > MAX_STYLE_SHEET_CHARS) return ''
  // Strip comments up front; an unterminated comment swallows the rest.
  let css = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const unterminated = css.indexOf('/*')
  if (unterminated !== -1) css = css.slice(0, unterminated)
  const rules = filterCssRules(css, scopeClass, true)
  const sheet = rules.join('\n')
  // Belt over braces: the grammars cannot produce '</' (no '/' anywhere in
  // a surviving selector or value), so a close-tag can never be smuggled
  // into the emitted <style> text. Assert it anyway.
  return /<\//.test(sheet) ? '' : sheet
}

/**
 * The sheets Gmail would keep: every `<style>` in head or body, except any
 * nested inside an element that is itself removed with its content
 * (noscript and friends — their bodies are mXSS material, not styling).
 */
const STYLE_BLOCKING_ANCESTORS = new Set(
  [...REMOVE_WITH_CONTENT_TAGS].filter(tag => tag !== 'head'),
)

function collectMessageStyleSheets(doc: Document): string[] {
  const sheets: string[] = []
  for (const styleEl of [...doc.querySelectorAll('style')]) {
    let blocked = false
    for (let p = styleEl.parentElement; p !== null; p = p.parentElement) {
      if (STYLE_BLOCKING_ANCESTORS.has(p.tagName.toLowerCase())) {
        blocked = true
        break
      }
    }
    if (!blocked) sheets.push(styleEl.textContent ?? '')
  }
  return sheets
}

function sanitizeAttributes(element: Element, tag: string): void {
  const allowed = PER_TAG_ALLOWED_ATTRS[tag]
  for (const attr of [...element.attributes]) {
    const name = attr.name.toLowerCase()
    if (GLOBAL_ALLOWED_ATTRS.has(name) || allowed?.has(name)) continue
    if (name === 'style') {
      const filtered = filterInlineStyle(attr.value)
      if (filtered) {
        element.setAttribute('style', filtered)
        continue
      }
    }
    const globalPattern = GLOBAL_ATTR_PATTERNS[name]
    if (globalPattern?.test(attr.value.trim())) continue
    if (name === 'class') {
      const rewritten = rewriteClassAttribute(attr.value)
      if (rewritten) {
        element.setAttribute('class', rewritten)
        continue
      }
    }
    if (name === 'id') {
      const token = attr.value.trim()
      if (NAME_TOKEN.test(token)) {
        element.setAttribute('id', CONTENT_ID_PREFIX + token)
        continue
      }
    }
    element.removeAttribute(attr.name)
  }
  if (tag === 'font') {
    for (const [name, pattern] of Object.entries(FONT_ATTR_PATTERNS)) {
      const value = element.getAttribute(name)
      if (value === null) continue
      const candidate =
        name === 'color' ? value.replace(/\s+/g, '') : value.trim()
      if (!pattern.test(candidate)) element.removeAttribute(name)
    }
  }
  if (TABLE_ATTR_TAGS.has(tag)) {
    for (const [name, pattern] of Object.entries(TABLE_ATTR_PATTERNS)) {
      const value = element.getAttribute(name)
      if (value === null) continue
      // bgcolor may be written `rgb(1, 2, 3)`; strip internal whitespace so
      // the space-free color grammar applies. The others are single tokens.
      const candidate =
        name === 'bgcolor'
          ? value.replace(/\s+/g, '')
          : value.trim()
      if (!pattern.test(candidate)) element.removeAttribute(name)
    }
  }
  if (tag === 'img') {
    for (const name of ['width', 'height']) {
      const value = element.getAttribute(name)
      if (value !== null && !isLayoutDimension(value)) {
        element.removeAttribute(name)
      }
    }
    // Both or neither: one dimension alone gives no ratio, and paired
    // with `height: auto` it would squash the image.
    if (
      element.hasAttribute('width') !== element.hasAttribute('height')
    ) {
      element.removeAttribute('width')
      element.removeAttribute('height')
    }
  }
  const href = element.getAttribute('href')
  if (href !== null && !isAllowedHref(href)) element.removeAttribute('href')
  const src = element.getAttribute('src')
  if(tag==='video'||tag==='audio') {
    if(src!==null && !/^cid:[a-z0-9@._-]+$/i.test(src) && !new RegExp(`^data:${tag}/(?:mp4|webm|ogg|mpeg|mp3|wav);base64,[a-z0-9+/=\\s]+$`,'i').test(src))element.removeAttribute('src')
    element.setAttribute('controls','');element.setAttribute('preload','none')
  } else if (src !== null && !isAllowedSrc(src)) element.removeAttribute('src')
  if (tag === 'a' && element.hasAttribute('href')) {
    // Mail content must never script or navigate its opener.
    element.setAttribute('target', '_blank')
    element.setAttribute('rel', 'noopener noreferrer')
  }
}

function sanitizeNode(node: Node): void {
  if (node.nodeType === node.TEXT_NODE) return
  if (node.nodeType !== node.ELEMENT_NODE) {
    // Comments (incl. conditional comments), CDATA, processing instructions.
    node.parentNode?.removeChild(node)
    return
  }
  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (REMOVE_WITH_CONTENT_TAGS.has(tag) || !ALLOWED_TAGS.has(tag)) {
    if (REMOVE_WITH_CONTENT_TAGS.has(tag)) {
      element.remove()
      return
    }
    // Unknown but harmless wrapper (center, section, font…): keep the
    // content, drop the element — after sanitizing the children in place.
    for (const child of [...element.childNodes]) sanitizeNode(child)
    const parent = element.parentNode
    if (!parent) return
    while (element.firstChild) parent.insertBefore(element.firstChild, element)
    element.remove()
    return
  }
  sanitizeAttributes(element, tag)
  for (const child of [...element.childNodes]) sanitizeNode(child)
}

/**
 * Collapse spacer blocks: mail clients emit `<p><br></p>` / `<div><br></div>`
 * runs between paragraphs, and each one rendered as a full empty line PLUS
 * two paragraph margins — inches of air between two sentences. A block with
 * no text and no meaningful children (only <br>/whitespace) is dropped; the
 * neighbours' own margins already separate the paragraphs. Blocks that SET
 * their own spacing (see hasExplicitSpacing) are deliberate spacers in
 * designed mail and stay.
 */
function collapseSpacerBlocks(root: Element): void {
  for (const block of [...root.querySelectorAll('p, div')]) {
    if ((block.textContent ?? '').replace(/\u00a0/g, ' ').trim() !== '') {
      continue
    }
    const meaningful = block.querySelector(
      'img, table, hr, iframe, ul, ol, blockquote, a[href]',
    )
    if (meaningful) continue
    if (hasExplicitSpacing(block)) continue
    block.remove()
  }
}

/**
 * Style properties whose presence marks an empty block as DESIGNED spacing
 * rather than editor residue. MJML and friends emit explicit spacers \u2014
 * `<div style="height:20px;line-height:20px">&hairsp;</div>` \u2014 between
 * every card in a newsletter; collapsing those crushed the layout by
 * hundreds of pixels. A block claiming its own height, line-height,
 * padding or margin is layout, not litter. (The style attribute read here
 * is the already-FILTERED one, so the values are grammar-clean.)
 */
const SPACER_STYLE_PROP =
  /^(?:height|min-height|line-height|padding(?:-top|-bottom)?|margin(?:-top|-bottom)?)$/

function hasExplicitSpacing(block: Element): boolean {
  const style = block.getAttribute('style')
  if (!style) return false
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const property = declaration.slice(0, colon).trim()
    if (!SPACER_STYLE_PROP.test(property)) continue
    // Shorthands (`padding: 0 0 10px 0`) count if ANY side is nonzero.
    const tokens = declaration.slice(colon + 1).trim().split(/\s+/)
    if (tokens.some(token => !/^(?:0(?:px|pt|em|%)?|normal|auto)$/.test(token))) {
      return true
    }
  }
  return false
}

/**
 * Scope-class source. A plain module counter: the class only has to be
 * unique among the messages currently mounted in one document, and every
 * sanitize pass mints a fresh one.
 */
let messageScopeCounter = 0

function sanitizedMailBody(html: string): string {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  // Capture embedded sheets BEFORE the walk removes every <style> (and the
  // walk never visits <head>, where newsletters actually put them).
  const rawSheets = collectMessageStyleSheets(doc)
  for (const child of [...doc.body.childNodes]) sanitizeNode(child)
  collapseSpacerBlocks(doc.body)
  const scopeClass = `pm-msg-${++messageScopeCounter}`
  const css = rawSheets
    .map(sheet => filterMessageStyleSheet(sheet, scopeClass))
    .filter(Boolean)
    .join('\n')
  if (!css) return doc.body.innerHTML
  // Only when filtered CSS survives does the output grow a scope container:
  // <div class="pm-msg-N"><style>…scoped rules…</style>…message…</div>.
  // The style element rides inside the sanitized fragment itself —
  // dangerouslySetInnerHTML renders it fine inside a div — and its rules
  // can only match inside this wrapper.
  const wrapper = doc.createElement('div')
  wrapper.setAttribute('class', scopeClass)
  const styleEl = doc.createElement('style')
  styleEl.textContent = css
  wrapper.appendChild(styleEl)
  while (doc.body.firstChild) wrapper.appendChild(doc.body.firstChild)
  doc.body.appendChild(wrapper)
  return doc.body.innerHTML
}

export function sanitizeMailHtml(
  html: string,
  options: { allowRemoteImages?: boolean } = {},
): string {
  const clean = sanitizedMailBody(html)
  if (options.allowRemoteImages) return clean
  return blockRemoteImagesInMailHtml(clean).html
}

/** Whether the sanitized rendering of `html` blocked any remote images. */
export function mailHtmlHasRemoteImages(html: string): boolean {
  return blockRemoteImagesInMailHtml(sanitizedMailBody(html)).blockedCount > 0
}
