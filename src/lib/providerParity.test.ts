import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The guardrail from the provider-parity audit.
 *
 * The app once decided "is this account provider-backed?" with the literal
 * string 'gmail'. That gate starved the capability system, and its fallback
 * branches FAKED sends for any non-Gmail account. The fix was to route every
 * such decision through `activeProvider !== 'demo'` plus capability checks —
 * and this test is what keeps the string comparison from growing back.
 *
 * A new `=== 'gmail'` is allowed only where the code is genuinely about
 * Gmail: the Gmail provider itself, the Gmail settings card, and the helper
 * that turns a provider id into a display name. Add a file here only with
 * that justification in hand.
 */

const SRC_ROOT = join(__dirname, '..')

const GMAIL_COMPARISON = /===\s*'gmail'/g

/** Files where comparing against 'gmail' is the point, not a leak. */
const ALLOWED_FILES = new Set([
  // The Gmail provider is about Gmail by definition.
  'lib/gmailMailProvider.ts',
  // The provider display-name helper maps ids to names.
  'components/mailShellHelpers.ts',
  // The Gmail settings card looks up the Gmail account's address, and the
  // boot status line names the Gmail-specific sync message.
  'components/MailSettings.tsx',
  'components/PureMailShell.tsx',
])

/** Per-file ceilings so an allowed file cannot quietly accumulate more. */
const ALLOWED_COUNTS: Record<string, number> = {
  'components/MailSettings.tsx': 2,
  'components/PureMailShell.tsx': 1,
  'components/mailShellHelpers.ts': 1,
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    if (entry.name.includes('.test.')) return []
    return [path]
  })
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('provider parity guardrail', () => {
  it("keeps `=== 'gmail'` out of shared code paths", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC_ROOT)) {
      const relative = file.slice(SRC_ROOT.length + 1)
      const matches =
        stripComments(readFileSync(file, 'utf8')).match(GMAIL_COMPARISON) ?? []
      if (matches.length === 0) continue
      if (!ALLOWED_FILES.has(relative)) {
        offenders.push(`${relative}: ${matches.length} comparison(s)`)
        continue
      }
      const ceiling = ALLOWED_COUNTS[relative]
      if (ceiling !== undefined && matches.length > ceiling) {
        offenders.push(
          `${relative}: ${matches.length} comparison(s), ceiling ${ceiling}`,
        )
      }
    }
    expect(
      offenders,
      'A new === \'gmail\' comparison appeared outside the Gmail-specific files. ' +
        'Gate on activeProvider !== \'demo\' plus mailProviderSupports instead — ' +
        'the string gate is how sends came to be faked on non-Gmail accounts.',
    ).toEqual([])
  })

  it('keeps the local-pretend send branches demo-only', () => {
    // The component that sends must never regrow a branch that pretends a
    // provider-backed send happened. Gate shape: the provider is chosen by
    // "not demo", so the no-provider fallthrough can only be the simulation.
    // (ThreadReader stopped sending when replies moved into the docked
    // compose window — ComposeEditor is now the ONE sending surface.)
    for (const relative of ['components/ComposeEditor.tsx']) {
      const source = readFileSync(join(SRC_ROOT, relative), 'utf8')
      expect(
        source.includes("activeProvider !== 'demo'"),
        `${relative} must choose its send provider by "not demo"`,
      ).toBe(true)
    }
  })
})
