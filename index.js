/**
 * Host half of `dsh-skill-stats` — an adapter only.
 *
 * Everything with behaviour lives behind a module interface:
 *   lib/counter.js    record / snapshot / daily / reset / flush
 *   lib/inventory.js  list / invalidate
 *   lib/payload.js    buildPayload (pure)
 *   lib/window.js     day math and window filtering
 *   lib/skills-md.js  frontmatter parsing and origin classification (pure)
 *
 * This file wires the two host events and the HTTP route to those modules and
 * exports exactly what the Loader needs. Counting starts when the plugin is
 * first enabled; no session log is ever read.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { createCounter } from './lib/counter.js'
import { createDiagnostics } from './lib/diagnostics.js'
import { createInventory } from './lib/inventory.js'
import { buildPayload } from './lib/payload.js'
import { normalizeWindow } from './lib/window.js'

/** Stable Loader identity, following the shipped tool plugins. */
export const name = 'dsh-skill-stats'

/** Services the host half needs; a composition without them leaves the row inactive. */
export const inject = ['webServer', 'skills', 'agentPresets']

/** Route the browser half reads. Same-origin, so the GUI's own auth applies. */
export const ROUTE = '/dsh-skill-stats/api'

/** Write one JSON response. */
function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * Host plugin body.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const diagnostics = createDiagnostics()
  const counter = createCounter({ dir: join(home, 'storages', 'dsh-skill-stats'), diagnostics })

  let projectDir = ''
  try {
    const working = ctx.get('workingDirectory')
    if (working && typeof working.defaultDirectory === 'string') projectDir = working.defaultDirectory
  } catch {
    // No working-directory service in this composition: user roots still work.
  }

  const inventory = createInventory({
    skills: ctx.skills,
    presets: ctx.agentPresets,
    dshHome: home,
    profileDir: process.env.DSH_PROFILE_DIR || '',
    projectDir,
    diagnostics,
  })

  // An agent calling the `skill` tool. `arguments` is already parsed here.
  ctx.on(
    'tools/result',
    (exec, result) => {
      try {
        if (!exec || exec.name !== 'skill') return
        const args = exec.arguments
        const skill = args && typeof args === 'object' ? String(args.name || '') : ''
        if (skill === '') return
        const sessionId = exec.agent && exec.agent.id ? String(exec.agent.id) : ''
        counter.record({ skill, kind: 'agent', sessionId, failed: Boolean(result && result.isError) })
      } catch {
        // Counting must never disturb a tool call.
      }
    },
    'dsh-skill-stats: skill tool results',
  )

  // A user invoking a skill as `/name`; the host injects it as a user message.
  ctx.on(
    'session/event',
    (session, event) => {
      try {
        if (!event || event.type !== 'user/message') return
        const source = event.data && event.data.source
        if (!source || source.kind !== 'skill-invocation') return
        const skill = String(source.name || '')
        if (skill === '') return
        const header = session && session.header
        const sessionId = header && header.id ? String(header.id) : ''
        counter.record({ skill, kind: 'user', sessionId })
      } catch {
        // Counting must never disturb a session.
      }
    },
    'dsh-skill-stats: skill invocations',
  )

  // The skill catalog changed: drop both cached views of the inventory.
  ctx.on('skills/change', () => inventory.invalidate(), 'dsh-skill-stats: invalidate inventory')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          try {
            const url = new URL(req.url || ROUTE, 'http://localhost')
            const window = normalizeWindow(url.searchParams.get('window'))
            const rows = await inventory.list()
            writeJson(res, 200, buildPayload(counter.snapshot(window), rows, { generatedAt: Date.now(), diagnostics: diagnostics.list() }))
          } catch (error) {
            writeJson(res, 500, { error: String((error && error.message) || error) })
          }
        },
      }),
    'dsh-skill-stats: statistics route',
  )

  ctx.effect(() => () => counter.flush(), 'dsh-skill-stats: flush counters on unload')
}
