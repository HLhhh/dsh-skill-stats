import assert from 'node:assert/strict'
import test from 'node:test'
import { DAY_MS, cutoffFor, dayInWindow, dayKey, normalizeWindow } from '../lib/window.js'

test('normalizeWindow keeps known windows and falls back to all', () => {
  assert.equal(normalizeWindow('today'), 'today')
  assert.equal(normalizeWindow('7d'), '7d')
  assert.equal(normalizeWindow('30d'), '30d')
  assert.equal(normalizeWindow('all'), 'all')
  assert.equal(normalizeWindow(null), 'all')
  assert.equal(normalizeWindow('bogus'), 'all')
})

test('dayKey uses local calendar days', () => {
  const local = new Date(2026, 9, 26, 23, 59, 0).getTime()
  assert.equal(dayKey(local), '2026-10-26')
})

test('cutoffFor resolves each window against the given instant', () => {
  const now = new Date(2026, 9, 26, 12, 0, 0).getTime()
  assert.equal(cutoffFor('all', now), 0)
  assert.equal(cutoffFor('today', now), new Date(2026, 9, 26, 0, 0, 0).getTime())
  assert.equal(cutoffFor('7d', now), now - 7 * DAY_MS)
  assert.equal(cutoffFor('30d', now), now - 30 * DAY_MS)
})

test('dayInWindow includes any day that overlaps the window', () => {
  const now = new Date(2026, 9, 26, 12, 0, 0).getTime()
  assert.equal(dayInWindow('2026-10-26', cutoffFor('today', now)), true)
  assert.equal(dayInWindow('2026-10-25', cutoffFor('today', now)), false)
  assert.equal(dayInWindow('2026-10-25', cutoffFor('7d', now)), true)
  assert.equal(dayInWindow('not-a-day', cutoffFor('all', now)), false)
})
