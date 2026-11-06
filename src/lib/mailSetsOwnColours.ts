/**
 * Whether a sanitized message paints its own colours: a designed newsletter or receipt (a stylesheet, a coloured table,
 * inline colours or backgrounds). Those keep the light page their sender designed for in dark mode; a plain message, which
 * says nothing about colour, takes the reader's own ground and ink instead, so it never lights up a dark screen.
 */
export function mailSetsOwnColours(html: string): boolean {
  return /<style[\s>]/i.test(html)
    || /\sbgcolor\s*=/i.test(html)
    || /\sstyle\s*=\s*"[^"]*\b(?:background(?:-color)?|color)\s*:/i.test(html)
    || /\sstyle\s*=\s*'[^']*\b(?:background(?:-color)?|color)\s*:/i.test(html)
    || /<font[^>]*\scolor\s*=/i.test(html)
}
