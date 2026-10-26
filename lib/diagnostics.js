/**
 * The diagnostics module: one small outlet for failures the plugin swallows.
 *
 * Counting and inventory scans must never disturb the host, so their catches
 * stay silent by policy. That made real failures invisible (a broken store, an
 * unreadable profile). This module keeps a bounded, aggregate record of what was
 * swallowed, without logging data or touching the network.
 */

/** How many distinct failure sites are remembered. */
const DEFAULT_LIMIT = 20

/** Longest retained message. */
const MESSAGE_CHARS = 200

/**
 * Create a diagnostics sink.
 * @param limit - maximum distinct sites retained.
 * @returns `{ note(scope, error), list() }`.
 */
export function createDiagnostics(limit = DEFAULT_LIMIT) {
  const entries = new Map()

  /**
   * Record one swallowed failure. Never throws.
   * @param scope - stable site name, e.g. `counter.flush`.
   * @param error - the caught value.
   */
  function note(scope, error) {
    try {
      const message = error && error.message ? String(error.message) : String(error || '')
      const existing = entries.get(scope)
      const entry = existing || { scope, count: 0, lastAt: 0, message: '' }
      entry.count += 1
      entry.lastAt = Date.now()
      entry.message = message.slice(0, MESSAGE_CHARS)
      entries.set(scope, entry)
      while (entries.size > limit) {
        const oldest = [...entries.values()].sort((a, b) => a.lastAt - b.lastAt)[0]
        entries.delete(oldest.scope)
      }
    } catch {
      // A diagnostics sink that throws would be worse than the failure it reports.
    }
  }

  /** Aggregated sites, most recent first. */
  function list() {
    return [...entries.values()].sort((a, b) => b.lastAt - a.lastAt)
  }

  return { note, list }
}
