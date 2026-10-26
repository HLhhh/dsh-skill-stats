import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { createCounter } from '../lib/counter.js'
import { fakeClock, tempDir } from './support.mjs'

function setup() {
  const temp = tempDir()
  const clock = fakeClock()
  const counter = createCounter({ dir: join(temp.dir, 'storages', 'dsh-skill-stats'), clock })
  return { temp, clock, counter }
}

test('starts a baseline and counts agent and user uses', () => {
  const { temp, clock, counter } = setup()
  try {
    const start = counter.snapshot('all')
    assert.equal(start.startedAt, clock())
    assert.equal(start.calls, 0)

    counter.record({ skill: 'grilling', kind: 'agent', sessionId: 's1' })
    counter.record({ skill: 'grilling', kind: 'user', sessionId: 's2' })
    const snap = counter.snapshot('all')
    assert.equal(snap.calls, 2)
    assert.equal(snap.sessions, 2)
    assert.deepEqual(snap.perSkill.get('grilling'), { total: 2, agent: 1, user: 1, failed: 0, sessions: 2, lastUsed: clock() })
  } finally {
    temp.cleanup()
  }
})

test('de-duplicates sessions and counts failures', () => {
  const { temp, counter } = setup()
  try {
    counter.record({ skill: 'a', kind: 'agent', sessionId: 's1', failed: true })
    counter.record({ skill: 'a', kind: 'agent', sessionId: 's1' })
    const snap = counter.snapshot('all')
    assert.equal(snap.calls, 2)
    assert.equal(snap.sessions, 1)
    assert.equal(snap.perSkill.get('a').failed, 1)
  } finally {
    temp.cleanup()
  }
})

test('windows drop days outside the cutoff', () => {
  const { temp, clock, counter } = setup()
  try {
    counter.record({ skill: 'old', kind: 'agent', sessionId: 's1' })
    clock.advance(8 * 86_400_000)
    counter.record({ skill: 'new', kind: 'agent', sessionId: 's2' })
    assert.equal(counter.snapshot('7d').calls, 1)
    assert.equal(counter.snapshot('7d').perSkill.has('old'), false)
    assert.equal(counter.snapshot('all').calls, 2)
    assert.deepEqual(counter.daily('all').map((entry) => entry.total), [1, 1])
  } finally {
    temp.cleanup()
  }
})

test('persists across instances and resets the baseline', () => {
  const { temp, clock, counter } = setup()
  try {
    counter.record({ skill: 'a', kind: 'agent', sessionId: 's1' })
    counter.flush()

    const reopened = createCounter({ dir: join(temp.dir, 'storages', 'dsh-skill-stats'), clock })
    assert.equal(reopened.snapshot('all').calls, 1)
    assert.equal(reopened.snapshot('all').startedAt, counter.snapshot('all').startedAt)

    clock.advance(1000)
    const startedAt = reopened.reset()
    assert.equal(startedAt, clock())
    assert.equal(reopened.snapshot('all').calls, 0)
    assert.equal(createCounter({ dir: join(temp.dir, 'storages', 'dsh-skill-stats'), clock }).snapshot('all').calls, 0)
  } finally {
    temp.cleanup()
  }
})

test('ignores unusable names and survives a missing directory', () => {
  const { temp } = setup()
  try {
    const clock = fakeClock()
    const counter = createCounter({ dir: join(temp.dir, 'deep', 'nested', 'dir'), clock })
    counter.record({ skill: '' })
    counter.record({ skill: 'x'.repeat(201) })
    counter.record({})
    assert.equal(counter.snapshot('all').calls, 0)
  } finally {
    temp.cleanup()
  }
})
