import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { createInventory } from '../lib/inventory.js'
import { fakeClock, tempDir, writeSkill } from './support.mjs'

function profileWithPlugin(profileDir) {
  const skillDir = join(profileDir, 'node_modules', '@acme', 'cool-plugin', 'skill')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { '@acme/cool-plugin': '1.0.0' } }))
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: cool-skill\ndescription: from a plugin\n---\n')
}

function services() {
  return {
    skills: {
      async list(options = {}) {
        if (options.scope) return [{ name: 'preset-only', description: 'from a preset', source: 'bundled', provider: 'filesystem' }]
        return [
          { name: 'grilling', description: 'from the service', source: 'user-dsh', provider: 'filesystem', invocation: { modelInvocable: true } },
          { name: 'cool-skill', description: '', source: 'bundled', provider: 'filesystem', path: '', invocation: {} },
        ]
      },
    },
    presets: {
      async list() {
        return [{ id: 'standard' }]
      },
      async acquireScope() {
        return { key: 'scope-1', [Symbol.asyncDispose]: async () => {} }
      },
    },
  }
}

test('merges service, disk, plugin-package and preset sources', async () => {
  const home = tempDir()
  const profile = tempDir()
  try {
    writeSkill(join(home.dir, 'skills'), 'manual-only', '---\r\nname: manual-only\r\ndisable-model-invocation: true\r\n---\r\n')
    profileWithPlugin(profile.dir)

    const { skills, presets } = services()
    const inventory = createInventory({ skills, presets, dshHome: home.dir, profileDir: profile.dir, clock: fakeClock() })
    const rows = await inventory.list()
    const byName = new Map(rows.map((row) => [row.name, row]))

    assert.equal(byName.get('grilling').description, 'from the service')
    assert.equal(byName.get('grilling').origin.kind, 'self')
    assert.equal(byName.get('manual-only').origin.kind, 'self')
    assert.equal(byName.get('manual-only').modelInvocable, false)
    assert.equal(byName.get('cool-skill').origin.kind, 'plugin')
    assert.equal(byName.get('cool-skill').origin.label, '@acme/cool-plugin')
    assert.match(byName.get('cool-skill').path, /node_modules\/@acme\/cool-plugin\/skill\/SKILL\.md$/)
    assert.equal(byName.get('preset-only').origin.kind, 'bundled')
    assert.deepEqual(rows.map((row) => row.name), [...rows.map((row) => row.name)].sort())
  } finally {
    home.cleanup()
    profile.cleanup()
  }
})

test('reads ~/.agents/skills from the real user home, not from DSH_HOME', async () => {
  const dsh = tempDir()
  const user = tempDir()
  try {
    writeSkill(join(user.dir, '.agents', 'skills'), 'agents-skill', '---\nname: agents-skill\n---\n')
    const inventory = createInventory({
      skills: { async list() { return [] } },
      presets: null,
      dshHome: dsh.dir,
      userHome: user.dir,
      clock: fakeClock(),
    })
    const rows = await inventory.list()
    const row = rows.find((entry) => entry.name === 'agents-skill')
    assert.ok(row, 'found under the injected user home')
    assert.equal(row.origin.kind, 'self')
  } finally {
    dsh.cleanup()
    user.cleanup()
  }
})

test('a throwing preset service is reported through diagnostics', async () => {
  const home = tempDir()
  try {
    const { createDiagnostics } = await import('../lib/diagnostics.js')
    const diagnostics = createDiagnostics()
    const inventory = createInventory({
      skills: { async list() { return [] } },
      presets: {
        async list() {
          throw new Error('preset registry offline')
        },
      },
      dshHome: home.dir,
      clock: fakeClock(),
      diagnostics,
    })
    await inventory.list()
    const scopes = diagnostics.list().map((entry) => entry.scope)
    assert.ok(scopes.includes('inventory.presets-list'), `got ${scopes.join(',')}`)
  } finally {
    home.cleanup()
  }
})

test('caches the listing and invalidates on demand', async () => {
  const home = tempDir()
  try {
    const clock = fakeClock()
    const { skills, presets } = services()
    const inventory = createInventory({ skills, presets, dshHome: home.dir, clock })
    const first = await inventory.list()
    assert.equal(await inventory.list(), first, 'cached call returns the same rows')

    clock.advance(61_000)
    assert.notEqual(await inventory.list(), first, 'cache expires after a minute')

    inventory.invalidate()
    await inventory.list()
    writeSkill(join(home.dir, 'skills'), 'fresh', '---\nname: fresh\n---\n')
    inventory.invalidate()
    assert.ok((await inventory.list()).some((row) => row.name === 'fresh'))
  } finally {
    home.cleanup()
  }
})
