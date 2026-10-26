/**
 * Dependency-free smoke tests.
 *
 * They run in CI and locally (`npm test`) and cover the two failures that
 * packaging usually hides: the host module no longer exports what the Loader
 * expects, and the browser bundle can no longer register its two slots.
 */

import assert from 'node:assert/strict'

/* ── host half ──────────────────────────────────────────────────────────── */

const host = await import('../index.js')

assert.equal(host.name, 'dsh-skill-stats', 'host module name must match the package')
assert.equal(typeof host.apply, 'function', 'host module must export apply()')
assert.equal(host.ROUTE, '/dsh-skill-stats/api', 'route must stay under the package path')

assert.equal(host.normalizeWindow('7d'), '7d')
assert.equal(host.normalizeWindow('30d'), '30d')
assert.equal(host.normalizeWindow('today'), 'today')
assert.equal(host.normalizeWindow('nonsense'), 'all', 'unknown windows fall back to all')

const now = Date.now()
const day = (() => {
  const date = new Date(now)
  const pad = (value) => (value < 10 ? '0' + value : String(value))
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
})()

const state = {
  version: 1,
  startedAt: now - 1000,
  skills: {
    grilling: {
      last: now,
      days: { [day]: { total: 2, agent: 1, user: 1, failed: 0, last: now, sessions: ['s1', 's2'] } },
    },
    ghost: {
      last: now,
      days: { [day]: { total: 1, agent: 1, user: 0, failed: 1, last: now, sessions: ['s1'] } },
    },
  },
}

const inventory = [
  { name: 'grilling', description: '', source: 'user-dsh', provider: 'filesystem', path: '', modelInvocable: true, userInvocable: true, origin: { kind: 'self', label: '' } },
]

const payload = host.buildPayload(state, inventory, 'all')
assert.equal(payload.startedAt, state.startedAt)
assert.equal(payload.totals.installed, 1)
assert.equal(payload.totals.used, 1)
assert.equal(payload.totals.unused, 0)
assert.equal(payload.totals.calls, 3)
assert.equal(payload.totals.sessions, 2)
assert.equal(payload.totals.failed, 1)
assert.equal(payload.skills[0].total, 2)
assert.equal(payload.skills[0].agent, 1)
assert.equal(payload.skills[0].user, 1)
assert.ok(payload.skills[0].share > 0.66 && payload.skills[0].share < 0.67)
assert.equal(payload.uninstalled.length, 1)
assert.equal(payload.uninstalled[0].name, 'ghost')

// The window filter drops days older than the cutoff.
const oldDay = '2001-01-01'
const oldState = {
  startedAt: 0,
  skills: { grilling: { last: 0, days: { [oldDay]: { total: 5, agent: 5, user: 0, failed: 0, last: 0, sessions: ['s1'] } } } },
}
assert.equal(host.buildPayload(oldState, inventory, 'today').totals.calls, 0)
assert.equal(host.buildPayload(oldState, inventory, 'all').totals.calls, 5)

/* ── browser half ───────────────────────────────────────────────────────── */

let definition = null
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    },
  },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
}

await import('../client.js')
assert.ok(definition, 'client bundle must call __ModuleLoader__.load()')
assert.equal(definition.id, 'dsh-skill-stats', 'bundle id must match the package name')

const React = {
  createElement: () => null,
  useEffect() {},
  useState(initial) {
    return [initial, () => {}]
  },
  useMemo(factory) {
    return factory()
  },
  useCallback(fn) {
    return fn
  },
  useRef(value) {
    return { current: value }
  },
}

const plugin = definition.factory((specifier) => (specifier === 'react' ? React : undefined))
assert.deepEqual(plugin.inject, ['slots', 'locale'])
assert.equal(typeof plugin.apply, 'function')

const registrations = []
const ctx = {
  effect(fn) {
    fn()
  },
  locale: {
    register() {
      return () => {}
    },
    bind() {
      return (key) => key
    },
    subscribe() {
      return () => {}
    },
  },
  slots: {
    inject(_slot, callback) {
      return callback()
    },
    register(options) {
      registrations.push(options.name)
      return () => {}
    },
  },
}

plugin.apply(ctx)
assert.ok(registrations.includes('main'), 'must register the main panel')
assert.ok(registrations.includes('sidebar.panellist'), 'must register the sidebar entry')

console.log('smoke tests passed')
