import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { tempDir } from './support.mjs'

/** A host context just real enough to wire the plugin. */
function createCtx() {
  const handlers = new Map()
  const disposers = []
  let route = null
  let summaries = [{ name: 'grilling', description: 'from the service', source: 'user-dsh', provider: 'filesystem', invocation: {} }]
  const ctx = {
    on(name, fn) {
      const list = handlers.get(name) || []
      list.push(fn)
      handlers.set(name, list)
      return () => {}
    },
    effect(fn) {
      disposers.push(fn())
      return () => {}
    },
    get() {
      return undefined
    },
    skills: {
      async list() {
        return summaries
      },
    },
    agentPresets: {
      async list() {
        return []
      },
      async acquireScope() {
        throw new Error('no presets in this test')
      },
    },
    webServer: {
      register(value) {
        route = value
        return () => {}
      },
    },
  }
  return {
    ctx,
    handlers,
    disposers,
    route: () => route,
    setSummaries: (next) => {
      summaries = next
    },
  }
}

function emitEvent(handlers, name, ...args) {
  for (const fn of handlers.get(name) || []) fn(...args)
}

function request(route, { url = '/dsh-skill-stats/api?window=all', method = 'GET' } = {}) {
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: null,
      body: '',
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(text) {
        this.body = text || ''
        resolve(this)
      },
    }
    route.handler({ method, url }, res)
  })
}

test('counts agent and user usage, serves the payload and flushes on unload', async () => {
  const home = tempDir()
  const previousHome = process.env.DSH_HOME
  const previousProfile = process.env.DSH_PROFILE_DIR
  process.env.DSH_HOME = home.dir
  process.env.DSH_PROFILE_DIR = join(home.dir, 'profile')
  try {
    const { apply } = await import('../index.js')
    const harness = createCtx()
    apply(harness.ctx)

    // Turn 1: the agent loads grilling. Turn 2: the user names it again.
    const session = { header: { id: 's1' } }
    let seq = 0
    const emit = (type, data) => emitEvent(harness.handlers, 'session/event', session, { type, seq: ++seq, data })
    emit('turn/start', { turn: 1 })
    emit('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: JSON.stringify({ name: 'grilling' }) })
    emit('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1' } })
    emit('turn/start', { turn: 2 })
    emit('user/message', { content: [{ type: 'text', text: '再来一次grilling' }], source: { kind: 'user' } })
    // Noise that must not be counted.
    emit('tool/call', { turn: 2, callId: 'c2', name: 'bash', arguments: '{}' })
    emit('tool/result', { turn: 2, message: { toolCallId: 'c2' } })

    const route = harness.route()
    assert.ok(route, 'route registered')
    assert.equal(route.path, '/dsh-skill-stats/api')

    const response = await request(route)
    assert.equal(response.status, 200)
    const payload = JSON.parse(response.body)
    assert.equal(payload.totals.calls, 2)
    assert.equal(payload.totals.sessions, 1)
    assert.equal(payload.skills[0].name, 'grilling')
    assert.equal(payload.skills[0].total, 2)
    assert.deepEqual(payload.uninstalled, [])
    assert.deepEqual(payload.diagnostics, [], 'a healthy run reports no swallowed failures')

    const today = JSON.parse((await request(route, { url: '/dsh-skill-stats/api?window=today' })).body)
    assert.equal(today.totals.calls, 2)
    assert.equal(today.window, 'today')

    const rejected = await request(route, { method: 'POST' })
    assert.equal(rejected.status, 405)

    // Catalog invalidation is wired: a changed service list shows up.
    harness.setSummaries([{ name: 'grilling', description: '', source: 'user-dsh', provider: 'filesystem', invocation: {} }, { name: 'brand-new', description: '', source: 'user-dsh', provider: 'filesystem', invocation: {} }])
    emitEvent(harness.handlers, 'skills/change')
    const afterChange = JSON.parse((await request(route)).body)
    assert.ok(afterChange.skills.some((row) => row.name === 'brand-new'))

    for (const dispose of harness.disposers) if (typeof dispose === 'function') dispose()
    const counterFile = join(home.dir, 'storages', 'dsh-skill-stats', 'usage.json')
    assert.equal(existsSync(counterFile), true, 'unload flushes the counters')
    const stored = JSON.parse(readFileSync(counterFile, 'utf8'))
    assert.equal(stored.skills.grilling.days[Object.keys(stored.skills.grilling.days)[0]].total, 2)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousProfile === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previousProfile
    home.cleanup()
  }
})
