/**
 * The counter module: everything about recording a use and reading totals back.
 *
 * Behaviour behind the interface: per-day buckets, debounced atomic persistence,
 * window filtering, session de-duplication, reset. The interface is five calls
 * and one injected directory plus clock — callers never touch the file format,
 * and tests run against a temporary directory with a fake clock.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cutoffFor, dayInWindow, dayKey } from './window.js'

/** File name inside the injected directory. */
export const COUNTER_FILE = 'usage.json'

/** How long consecutive records are batched before writing. */
const FLUSH_MS = 800

/** The stored shape. Only aggregate numbers are kept. */
function emptyState(now) {
  return { version: 1, startedAt: now, skills: {} }
}

/**
 * Validate a loaded document. Anything unexpected starts a fresh baseline
 * instead of failing the panel.
 * @param value - parsed JSON.
 * @returns a usable state, or null.
 */
function coerceState(value) {
  if (!value || typeof value !== 'object') return null
  if (!value.skills || typeof value.skills !== 'object') return null
  return { version: 1, startedAt: Number(value.startedAt) || Date.now(), skills: value.skills }
}

/**
 * Create a counter bound to one directory.
 * @param options - `{ dir, clock? }`; `clock` is injectable for tests.
 * @returns the counter interface.
 */
export function createCounter({ dir, clock = Date.now, diagnostics = null }) {
  const file = join(dir, COUNTER_FILE)
  let timer = null

  /** Write the current state atomically. */
  function flush() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    try {
      mkdirSync(dir, { recursive: true })
      const temp = file + '.tmp'
      writeFileSync(temp, JSON.stringify(state))
      renameSync(temp, file)
    } catch (error) {
      // The panel is a diagnostic; a failed write must not take the host down.
      if (diagnostics) diagnostics.note('counter.flush', error)
    }
  }

  /** Batch consecutive records into one write. */
  function scheduleFlush() {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, FLUSH_MS)
    if (typeof timer.unref === 'function') timer.unref()
  }

  /** Load the counter file, creating a baseline on first run. */
  function load() {
    let parsed = null
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      parsed = null
      // A missing file is the first run; only a real read failure is notable.
      if (diagnostics && !(error && error.code === 'ENOENT')) diagnostics.note('counter.read', error)
    }
    const state = coerceState(parsed)
    if (state !== null) return state
    const fresh = emptyState(clock())
    try {
      mkdirSync(dir, { recursive: true })
      const temp = file + '.tmp'
      writeFileSync(temp, JSON.stringify(fresh))
      renameSync(temp, file)
    } catch (error) {
      // A read-only home still leaves an in-memory counter for this run.
      if (diagnostics && !(error && error.code === 'ENOENT')) diagnostics.note('counter.load', error)
    }
    return fresh
  }

  let state = load()

  /**
   * Record one use. Fire-and-forget: never throws, never returns anything.
   * @param use - `{ skill, kind, sessionId?, failed? }`.
   */
  function record(use) {
    const skill = use && typeof use.skill === 'string' ? use.skill : ''
    if (skill === '' || skill.length > 200) return
    const now = clock()
    let entry = state.skills[skill]
    if (!entry) {
      entry = { days: {}, last: 0 }
      state.skills[skill] = entry
    }
    const day = dayKey(now)
    let bucket = entry.days[day]
    if (!bucket) {
      bucket = { total: 0, agent: 0, user: 0, failed: 0, last: 0, sessions: [] }
      entry.days[day] = bucket
    }
    bucket.total += 1
    if (use.kind === 'user') bucket.user += 1
    else bucket.agent += 1
    if (use.failed) bucket.failed += 1
    if (now > bucket.last) bucket.last = now
    const sessionId = typeof use.sessionId === 'string' ? use.sessionId : ''
    if (sessionId !== '' && bucket.sessions.indexOf(sessionId) === -1) bucket.sessions.push(sessionId)
    if (now > entry.last) entry.last = now
    scheduleFlush()
  }

  /**
   * Aggregate usage for one window.
   * @param window - normalised window name.
   * @returns `{ startedAt, window, cutoff, calls, failed, sessions, perSkill }`
   * where `perSkill` maps a skill name to its totals for that window.
   */
  function snapshot(window) {
    const cutoff = cutoffFor(window, clock())
    const perSkill = new Map()
    const sessions = new Set()
    let calls = 0
    let failed = 0
    for (const [skill, entry] of Object.entries(state.skills)) {
      let total = 0
      let agent = 0
      let user = 0
      let errors = 0
      let lastUsed = 0
      const skillSessions = new Set()
      for (const [day, bucket] of Object.entries(entry.days || {})) {
        if (!dayInWindow(day, cutoff)) continue
        total += bucket.total || 0
        agent += bucket.agent || 0
        user += bucket.user || 0
        errors += bucket.failed || 0
        if (bucket.last > lastUsed) lastUsed = bucket.last
        for (const id of bucket.sessions || []) skillSessions.add(id)
      }
      if (total === 0) continue
      calls += total
      failed += errors
      for (const id of skillSessions) sessions.add(id)
      perSkill.set(skill, { total, agent, user, failed: errors, sessions: skillSessions.size, lastUsed })
    }
    return { startedAt: state.startedAt, window, cutoff, calls, failed, sessions: sessions.size, perSkill }
  }

  /**
   * Daily totals for one window, ascending by day. Kept as its own call so a
   * future trend chart does not need to widen `snapshot`.
   * @param window - normalised window name.
   * @returns `[{ day, total }]`.
   */
  function daily(window) {
    const cutoff = cutoffFor(window, clock())
    const days = new Map()
    for (const entry of Object.values(state.skills)) {
      for (const [day, bucket] of Object.entries(entry.days || {})) {
        if (!dayInWindow(day, cutoff)) continue
        days.set(day, (days.get(day) || 0) + (bucket.total || 0))
      }
    }
    return [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, total]) => ({ day, total }))
  }

  /** Start a fresh baseline at the current clock instant. */
  function reset() {
    state = emptyState(clock())
    flush()
    return state.startedAt
  }

  return { file, record, snapshot, daily, reset, flush }
}
