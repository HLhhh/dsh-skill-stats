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
const scan = {
  startedAt: now,
  scanMs: 1,
  sessions: 1,
  liveSessions: 0,
  fileSessions: 1,
  skipped: 0,
  inventory: [
    { name: 'grilling', description: '', source: 'user-dsh', provider: 'filesystem', path: '', modelInvocable: true, userInvocable: true, origin: { kind: 'self', label: '' } },
  ],
  usages: [
    { skill: 'grilling', time: now, sessionId: 's1', kind: 'agent', callId: 'c1', subagent: false },
    { skill: 'grilling', time: now, sessionId: 's2', kind: 'user', callId: '', subagent: false },
  ],
}

const payload = host.buildPayload(scan, 'all')
assert.equal(payload.totals.installed, 1)
assert.equal(payload.totals.used, 1)
assert.equal(payload.totals.calls, 2)
assert.equal(payload.totals.sessions, 2)
assert.equal(payload.skills[0].agent, 1)
assert.equal(payload.skills[0].user, 1)
assert.equal(payload.skills[0].share, 1)
assert.deepEqual(payload.uninstalled, [])

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
