import assert from 'node:assert/strict'
import test from 'node:test'
import { createUsageTracker } from '../lib/usage-tracker.js'

function setup() {
  const uses = []
  const tracker = createUsageTracker({ onUse: (use) => uses.push(use) })
  const session = { header: { id: 's1' } }
  let seq = 0
  const emit = (type, data) => tracker.handle(session, { type, seq: ++seq, data })
  const load = (skill, callId, opts = {}) => {
    emit('tool/call', { turn: opts.turn, step: 1, callId, name: 'skill', arguments: JSON.stringify({ name: skill }) })
    emit('tool/result', { turn: opts.turn, step: 1, message: { toolCallId: callId, isError: Boolean(opts.failed) } })
  }
  const userSays = (text, turn) => emit('user/message', { turn, content: [{ type: 'text', text }], source: { kind: 'user' } })
  return { uses, emit, load, userSays }
}

test('one load per turn counts once, however many times it happens', () => {
  const { uses, emit, load } = setup()
  emit('turn/start', { turn: 1 })
  load('code-review', 'c1', { turn: 1 })
  load('code-review', 'c2', { turn: 1 })
  assert.equal(uses.length, 1)
  assert.deepEqual(uses[0], { sessionId: 's1', skill: 'code-review', kind: 'agent', failed: false })
})

test('the same skill in a later turn counts again (the requested behaviour)', () => {
  const { uses, emit, load, userSays } = setup()
  emit('turn/start', { turn: 1 })
  load('code-review', 'c1', { turn: 1 })
  emit('turn/start', { turn: 2 })
  userSays('再做一次codereview', 2)
  assert.equal(uses.length, 2)
  assert.equal(uses[1].skill, 'code-review')
  assert.equal(uses[1].kind, 'user')
})

test('a mention only counts for a skill already loaded in this session', () => {
  const { uses, emit, userSays } = setup()
  emit('turn/start', { turn: 1 })
  userSays('please run archify later', 1)
  assert.equal(uses.length, 0)
})

test('/name invocation counts once and de-duplicates a same-turn mention', () => {
  const { uses, emit, userSays } = setup()
  emit('turn/start', { turn: 1 })
  emit('user/message', { content: [], source: { kind: 'skill-invocation', name: 'grilling' } })
  userSays('grilling again please', 1)
  assert.equal(uses.length, 1)
  assert.equal(uses[0].kind, 'user')
})

test('a failed skill call is counted and flagged', () => {
  const { uses, emit, load } = setup()
  emit('turn/start', { turn: 1 })
  load('grilling', 'c1', { turn: 1, failed: true })
  assert.equal(uses.length, 1)
  assert.equal(uses[0].failed, true)
})

test('unrelated noise is ignored', () => {
  const { uses, emit } = setup()
  emit('turn/start', { turn: 1 })
  emit('tool/call', { turn: 1, callId: 'x', name: 'bash', arguments: '{}' })
  emit('tool/result', { turn: 1, message: { toolCallId: 'x' } })
  emit('user/message', { content: [], source: { kind: 'skill-catalog', entries: [] } })
  assert.equal(uses.length, 0)
})
