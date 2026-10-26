import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPayload } from '../lib/payload.js'

const grilling = { name: 'grilling', description: '', source: 'user-dsh', provider: 'filesystem', path: '', modelInvocable: true, userInvocable: true, origin: { kind: 'self', label: '' } }
const other = { name: 'other', description: '', source: 'user-dsh', provider: 'filesystem', path: '', modelInvocable: true, userInvocable: true, origin: { kind: 'self', label: '' } }

function counts(overrides = {}) {
  return {
    startedAt: 1000,
    window: 'all',
    cutoff: 0,
    calls: 3,
    failed: 1,
    sessions: 2,
    perSkill: new Map([
      ['grilling', { total: 2, agent: 1, user: 1, failed: 1, sessions: 2, lastUsed: 5000 }],
      ['ghost', { total: 1, agent: 1, user: 0, failed: 0, sessions: 1, lastUsed: 6000 }],
    ]),
    ...overrides,
  }
}

test('shapes rows, shares and the uninstalled bucket', () => {
  const payload = buildPayload(counts(), [grilling, other], { generatedAt: 42 })
  assert.equal(payload.generatedAt, 42)
  assert.equal(payload.startedAt, 1000)
  assert.equal(payload.totals.installed, 2)
  assert.equal(payload.totals.used, 1)
  assert.equal(payload.totals.unused, 1)
  assert.equal(payload.totals.calls, 3)
  assert.equal(payload.totals.sessions, 2)
  assert.equal(payload.totals.failed, 1)

  const used = payload.skills.find((row) => row.name === 'grilling')
  assert.equal(used.total, 2)
  assert.ok(Math.abs(used.share - 2 / 3) < 1e-9)
  const unused = payload.skills.find((row) => row.name === 'other')
  assert.equal(unused.total, 0)
  assert.equal(unused.share, 0)

  assert.equal(payload.uninstalled.length, 1)
  assert.equal(payload.uninstalled[0].name, 'ghost')
  assert.ok(Math.abs(payload.uninstalled[0].share - 1 / 3) < 1e-9)
})

test('empty counts keep the inventory and divide by zero safely', () => {
  const payload = buildPayload(
    { startedAt: 0, window: 'today', cutoff: 9, calls: 0, failed: 0, sessions: 0, perSkill: new Map() },
    [grilling],
    { generatedAt: 7 },
  )
  assert.equal(payload.totals.calls, 0)
  assert.equal(payload.skills[0].share, 0)
  assert.deepEqual(payload.uninstalled, [])
  assert.equal(payload.window, 'today')
  assert.equal(payload.cutoff, 9)
  assert.equal(payload.generatedAt, 7)
})
