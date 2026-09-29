/**
 * React's development performance track can pass an unclonable prop diff to
 * Chromium. Profiling must not interrupt a render and strand navigation.
 * Preserve timing, but retry without diagnostic detail for that error only.
 */
export function guardDevelopmentTiming(timing: Pick<Performance, 'measure'>): () => void {
  const original = timing.measure
  const guarded: Performance['measure'] = (name, options, endMark) => {
    try {
      return original.call(timing, name, options, endMark)
    } catch (error) {
      if (
        !(error instanceof Error) || error.name !== 'DataCloneError' ||
        !name.startsWith('\u200b') || !options || typeof options !== 'object' ||
        !options.detail?.devtools
      ) throw error
      const { detail: _detail, ...bounds } = options
      return original.call(timing, name, bounds)
    }
  }
  timing.measure = guarded
  return () => { if (timing.measure === guarded) timing.measure = original }
}
