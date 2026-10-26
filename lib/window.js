/**
 * Calendar and window math for the counter.
 *
 * One owner for the rule "which days belong to a window": the writer and the
 * reader both go through this module, so a day boundary cannot drift between
 * the two.
 */

/** One day in milliseconds. */
export const DAY_MS = 86_400_000

/** Local calendar day key for a timestamp. */
export function dayKey(time) {
  const date = new Date(time)
  const pad = (value) => (value < 10 ? '0' + value : String(value))
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/**
 * Start of a local calendar day in epoch milliseconds.
 * @param day - `YYYY-MM-DD`.
 * @returns epoch milliseconds, or NaN when the key is malformed.
 */
export function dayStart(day) {
  return new Date(day + 'T00:00:00').getTime()
}

/**
 * Inclusive cutoff for a window name.
 * @param window - `all` | `today` | `7d` | `30d`.
 * @param now - the comparison instant.
 * @returns epoch milliseconds.
 */
export function cutoffFor(window, now = Date.now()) {
  if (window === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  if (window === '7d') return now - 7 * DAY_MS
  if (window === '30d') return now - 30 * DAY_MS
  return 0
}

/** Normalise the `window` query parameter. */
export function normalizeWindow(value) {
  return value === 'today' || value === '7d' || value === '30d' ? value : 'all'
}

/**
 * Whether a stored day belongs to the window ending at `cutoff`.
 * A day counts while any part of it is at or after the cutoff.
 */
export function dayInWindow(day, cutoff) {
  const start = dayStart(day)
  if (!Number.isFinite(start)) return false
  return start + DAY_MS > cutoff
}
