import assert from 'node:assert/strict'
import test from 'node:test'

/** The browser half must load through the real ModuleLoader contract. */
test('client bundle registers the sidebar entry and the main panel', async () => {
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
  assert.ok(definition, 'client bundle calls __ModuleLoader__.load()')
  assert.equal(definition.id, 'dsh-skill-stats', 'bundle id matches the package name')

  const React = {
    createElement: () => null,
    useEffect() {},
    useState(value) {
      return [value, () => {}]
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
  assert.ok(registrations.includes('main'))
  assert.ok(registrations.includes('sidebar.panellist'))
})
