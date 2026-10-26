import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { createCounter } from '../lib/counter.js'
import { createDiagnostics } from '../lib/diagnostics.js'
import { fakeClock, tempDir } from './support.mjs'

test('aggregates swallowed failures by site', () => {
  const diagnostics = createDiagnostics()
  assert.deepEqual(diagnostics.list(), [])

  diagnostics.note('counter.flush', new Error('EACCES'))
  diagnostics.note('counter.flush', new Error('EACCES again'))
  diagnostics.note('inventory.skills-service', 'boom')

  const list = diagnostics.list()
  assert.equal(list.length, 2)
  const flush = list.find((entry) => entry.scope === 'counter.flush')
  assert.equal(flush.count, 2)
  assert.match(flush.message, /EACCES/)
  assert.ok(flush.lastAt > 0)
})

test('stays bounded and never throws', () => {
  const diagnostics = createDiagnostics(2)
  diagnostics.note('a', new Error('1'))
  diagnostics.note('b', new Error('2'))
  diagnostics.note('c', new Error('3'))
  assert.equal(diagnostics.list().length, 2)
  assert.doesNotThrow(() => diagnostics.note('weird', undefined))
  assert.doesNotThrow(() => diagnostics.note('weird', { toString: () => { throw new Error('no') } }))
})

test('a broken store reports through diagnostics instead of failing silently', () => {
  const diagnostics = createDiagnostics()
  const counter = createCounter({ dir: join('/dev/null', 'nope'), clock: fakeClock(), diagnostics })
  counter.record({ skill: 'a', kind: 'agent', sessionId: 's1' })
  counter.flush()
  const scopes = diagnostics.list().map((entry) => entry.scope)
  assert.ok(scopes.includes('counter.load') || scopes.includes('counter.flush'), `got ${scopes.join(',')}`)
})

test('an unreadable profile manifest is reported', async () => {
  const { createInventory } = await import('../lib/inventory.js')
  const profile = tempDir()
  const home = tempDir()
  try {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(profile.dir, 'package.json'), '{ not json')
    const diagnostics = createDiagnostics()
    const inventory = createInventory({
      skills: { async list() { return [] } },
      presets: null,
      home: home.dir,
      profileDir: profile.dir,
      clock: fakeClock(),
      diagnostics,
    })
    await inventory.list()
    assert.ok(diagnostics.list().some((entry) => entry.scope === 'inventory.profile-manifest'))
  } finally {
    profile.cleanup()
    home.cleanup()
  }
})
