/**
 * Host half of `dsh-skill-stats`.
 *
 * Counting starts when the plugin is first enabled and lives in a small local
 * file; **no session log is ever read**. Two host events are the only inputs:
 *
 *  - `tools/result` for an agent calling the `skill` tool;
 *  - `session/event` for a user invoking a skill as `/name`.
 *
 * The panel route is therefore a cheap read of the counter file plus the skill
 * inventory.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Stable Loader identity, following the shipped tool plugins. */
export const name = 'dsh-skill-stats'

/** Services the host half needs; a composition without them leaves the row inactive. */
export const inject = ['webServer', 'skills', 'agentPresets']

/** Route the browser half reads. Same-origin, so the GUI's own auth applies. */
export const ROUTE = '/dsh-skill-stats/api'

/** One day in milliseconds. */
const DAY_MS = 86_400_000

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function parseSkillFrontmatter(text) {
  const meta = {}
  // A CRLF or BOM-prefixed file must parse like an LF one; without this, every
  // key in the frontmatter silently disappears.
  const source = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!source.startsWith('---')) return meta
  const end = source.indexOf('\n---', 3)
  if (end === -1) return meta
  for (const line of source.slice(3, end).split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1)
    }
    meta[match[1]] = value
  }
  return meta
}


/**
 * Installed plugin package directories, resolved from the profile manifest.
 * Local `link:` plugins and the profile's own `plugins/` directory are included
 * because a plugin's skills ship inside its package rather than in `$DSH_HOME`.
 * @returns `{ dir, packageName }` pairs.
 */
function installedPluginDirs() {
  const dirs = []
  const profile = process.env.DSH_PROFILE_DIR
  if (typeof profile !== 'string' || profile === '') return dirs
  let manifest = {}
  try {
    manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  } catch {
    manifest = {}
  }
  const modules = join(profile, 'node_modules')
  for (const name of Object.keys(manifest.dependencies || {})) {
    dirs.push({ dir: join(modules, name), packageName: name })
  }
  const local = join(profile, 'plugins')
  let entries = []
  try {
    entries = readdirSync(local, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    dirs.push({ dir: join(local, entry.name), packageName: entry.name })
  }
  return dirs
}


/**
 * The `SKILL.md` files a plugin package actually installs.
 *
 * Only the conventional locations are read — a package's own `docs/` or tests
 * can carry example skills that are not part of what it installs.
 * @param dir - package root.
 * @returns absolute file paths.
 */
function packageSkillFiles(dir) {
  const files = []
  try {
    if (statSync(join(dir, 'SKILL.md')).isFile()) files.push(join(dir, 'SKILL.md'))
  } catch {
    // No root-level SKILL.md is fine; the conventional subdirectories follow.
  }
  for (const sub of ['skill', 'skills', 'assets']) {
    files.push(...findSkillFiles(join(dir, sub), 1))
  }
  return files
}

/**
 * Every `SKILL.md` under one directory, ignoring nested dependencies.
 * @param dir - package root.
 * @param depth - recursion guard.
 * @returns absolute file paths.
 */
function findSkillFiles(dir, depth) {
  const level = depth || 0
  if (level > 2) return []
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findSkillFiles(path, level + 1))
    else if (entry.name === 'SKILL.md') out.push(path)
  }
  return out
}

/** Skill name → owning plugin package, rebuilt at most once a minute. */
let pluginSkillCache = null

/**
 * Skills that ship inside installed plugin packages.
 *
 * This is what separates "bundled with DSH" from "provided by a plugin you
 * installed": both look like `source: bundled` to the skills service, but only
 * the plugin ones live under the profile's own `node_modules`.
 * @returns `Map<string, {name, description, path, packageName, modelInvocable}>`.
 */
function pluginSkillIndex() {
  if (pluginSkillCache !== null && Date.now() - pluginSkillCache.at < 60_000) return pluginSkillCache.index
  const index = new Map()
  for (const plugin of installedPluginDirs()) {
    for (const file of packageSkillFiles(plugin.dir)) {
      let text = ''
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const meta = parseSkillFrontmatter(text)
      const name = typeof meta.name === 'string' && meta.name !== '' ? meta.name : file.split('/').slice(-2)[0]
      if (name === '' || index.has(name)) continue
      index.set(name, {
        name,
        description: typeof meta.description === 'string' ? meta.description : '',
        path: file,
        packageName: plugin.packageName,
        modelInvocable: meta['disable-model-invocation'] !== 'true',
      })
    }
  }
  pluginSkillCache = { at: Date.now(), index }
  return index
}

/**
 * Directories that hold installed skills.
 *
 * `ctx.skills.list()` only reports the layers visible to this plugin's own
 * (global) scope. A desktop profile mounts `~/.dsh/skills` inside the agent
 * preset's standing composition, so the service alone would leave every
 * user-installed skill out of the inventory. Reading the same directories keeps
 * the list complete; the service still supplies the richer metadata for the
 * skills it does know.
 * @param cwds - distinct working directories seen in the session corpus.
 * @returns `{ dir, source }` pairs.
 */
function skillRoots(cwds) {
  const roots = [
    { dir: join(dshHome(), 'skills'), source: 'user-dsh' },
    { dir: join(homedir(), '.agents', 'skills'), source: 'user-agents' },
  ]
  const bundled = process.env.DSH_BUNDLED_SKILL_DIR
  if (typeof bundled === 'string' && bundled !== '') roots.push({ dir: bundled, source: 'bundled' })
  for (const cwd of cwds) {
    roots.push({ dir: join(cwd, '.dsh', 'skills'), source: 'project-dsh' })
    roots.push({ dir: join(cwd, '.agents', 'skills'), source: 'project-agents' })
  }
  return roots
}

/**
 * Read every `<root>/<name>/SKILL.md` the filesystem offers.
 * @param cwds - distinct working directories.
 * @returns inventory rows (not yet classified).
 */
function readDiskSkills(cwds) {
  const found = new Map()
  for (const root of skillRoots(cwds)) {
    let entries = []
    try {
      entries = readdirSync(root.dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = join(root.dir, entry)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      const file = join(dir, 'SKILL.md')
      let text
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const meta = parseSkillFrontmatter(text)
      const name = typeof meta.name === 'string' && meta.name !== '' ? meta.name : entry
      if (found.has(name)) continue
      found.set(name, {
        name,
        description: typeof meta.description === 'string' ? meta.description : '',
        source: root.source,
        provider: 'filesystem',
        path: file,
        modelInvocable: meta['disable-model-invocation'] !== 'true',
        userInvocable: true,
      })
    }
  }
  return [...found.values()]
}

/**
 * Classify where a skill came from, for the panel's source badge.
 *
 * `source` alone cannot tell a bundle's own skill (archify, browser-skill) from
 * the harness-shipped ones, so the resource path is inspected when present:
 * anything living under a third-party `node_modules/<pkg>` is that plugin's
 * skill, and the harness's own packages stay `bundled`.
 * @param row - `{ source, provider, path }` from a skill summary.
 * @returns {{ kind: string, label: string }} badge kind and optional plugin label.
 */
function classifyOrigin(row) {
  const source = row.source
  const path = row.path || ''
  if (source === 'user-dsh' || source === 'user-agents' || source === 'custom') return { kind: 'self', label: '' }
  if (source === 'project-dsh' || source === 'project-agents') return { kind: 'project', label: '' }
  if (source === 'runtime') return { kind: 'self', label: '' }
  if (row.provider === 'dsh-office') return { kind: 'office', label: '' }
  if (source === 'bundled') {
    const match = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path)
    const packageName = match ? match[1] : ''
    if (packageName !== '' && packageName.indexOf('@deepseek-ai/') !== 0) return { kind: 'plugin', label: packageName }
    if (packageName !== '' && packageName.indexOf('dsh-agent-preset') !== -1) return { kind: 'bundled', label: '' }
    return { kind: 'bundled', label: '' }
  }
  return { kind: 'unknown', label: source || '' }
}

/**
 * Build the installed-skill inventory.
 * @param ctx - host plugin context.
 * @returns {Promise<object[]>} normalised skill rows, sorted by name.
 */
async function readInventory(ctx) {
  if (inventoryCache !== null && Date.now() - inventoryCache.at < 60_000) return inventoryCache.rows

  const byName = new Map()
  /** Merge one skills-service summary. */
  const addSummary = (summary) => {
    if (!summary || typeof summary.name !== 'string' || byName.has(summary.name)) return
    const invocation = summary.invocation || {}
    byName.set(summary.name, {
      name: summary.name,
      description: typeof summary.description === 'string' ? summary.description : '',
      source: typeof summary.source === 'string' ? summary.source : 'unknown',
      provider: typeof summary.provider === 'string' ? summary.provider : 'unknown',
      path: typeof summary.path === 'string' ? summary.path : '',
      modelInvocable: invocation.modelInvocable !== false,
      userInvocable: invocation.userInvocable !== false,
    })
  }

  let summaries = []
  try {
    summaries = await ctx.skills.list({})
  } catch {
    summaries = []
  }
  for (const summary of summaries) addSummary(summary)

  // Filesystem rows fill whatever the scoped service could not report.
  const cwds = []
  try {
    const working = ctx.get('workingDirectory')
    if (working && typeof working.defaultDirectory === 'string' && working.defaultDirectory !== '') cwds.push(working.defaultDirectory)
  } catch {
    // No working-directory service in this composition: user roots still work.
  }
  for (const disk of readDiskSkills(cwds)) {
    if (byName.has(disk.name)) continue
    byName.set(disk.name, disk)
  }

  // Skills shipped inside installed plugin packages. When the service reports one
  // as `bundled`, only the file's real location tells a plugin's skill apart.
  const plugins = pluginSkillIndex()
  for (const row of byName.values()) {
    const hit = plugins.get(row.name)
    if (!hit) continue
    if (row.path === '' || row.path.indexOf(hit.packageName) === -1) row.path = hit.path
    if (row.description === '') row.description = hit.description
    if (row.provider === 'unknown' || row.provider === 'session-catalog') row.provider = hit.packageName
  }
  for (const hit of plugins.values()) {
    if (byName.has(hit.name)) continue
    byName.set(hit.name, {
      name: hit.name,
      description: hit.description,
      source: 'bundled',
      provider: hit.packageName,
      path: hit.path,
      modelInvocable: hit.modelInvocable,
      userInvocable: true,
    })
  }

  // Preset-scoped skills (the ones a bundle mounts inside each agent preset) are
  // invisible to the global layer. Ask each preset for its scope and read the
  // merged view; this is a service call, not a session read.
  try {
    const presets = await ctx.agentPresets.list()
    for (const preset of presets) {
      const id = preset && (preset.id || preset.name)
      if (!id) continue
      let scope = null
      try {
        scope = await ctx.agentPresets.acquireScope(id)
        for (const summary of await ctx.skills.list({ scope: scope.key })) addSummary(summary)
      } catch {
        // A preset that cannot be scoped simply contributes nothing.
      } finally {
        if (scope && typeof scope[Symbol.asyncDispose] === 'function') {
          try {
            await scope[Symbol.asyncDispose]()
          } catch {
            // Disposal failures must not invalidate an otherwise good listing.
          }
        }
      }
    }
  } catch {
    // Older hosts without agent presets still get service + disk rows.
  }

  const rows = [...byName.values()]
    .map((row) => ({ ...row, origin: classifyOrigin(row) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  inventoryCache = { at: Date.now(), rows }
  return rows
}


/**
 * One full scan: inventory + every session's usage records.
 * @param ctx - host plugin context.
 * @returns {Promise<object>} the scan snapshot.
 */

function cutoffFor(window) {
  if (window === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  if (window === '7d') return Date.now() - 7 * DAY_MS
  if (window === '30d') return Date.now() - 30 * DAY_MS
  return 0
}

/** Normalise the `window` query parameter. */
function normalizeWindow(value) {
  return value === 'today' || value === '7d' || value === '30d' ? value : 'all'
}

/**
 * Aggregate one scan restricted to a window.
 * @param scan - the scan snapshot.
 * @param window - normalised window name.
 * @returns the API payload.
 */

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
 * Host plugin body: register the statistics route.
 * @param ctx - host plugin context.
 */


/**
 * Local counter file. Only aggregate numbers are stored: per skill, per local
 * day, the call counts and the sessions that used it.
 * @returns the absolute path.
 */
function storePath() {
  return join(dshHome(), 'storages', 'dsh-skill-stats', 'usage.json')
}

/** Inventory cache; skills change rarely, the panel reloads often. */
let inventoryCache = null

/** The counter state. */
let store = { version: 1, startedAt: null, skills: {} }

/** Pending debounce timer for consecutive writes. */
let flushTimer = null

/** Serialize the current state to disk (atomic replace). */
function flushStore() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  try {
    const file = storePath()
    mkdirSync(join(dshHome(), 'storages', 'dsh-skill-stats'), { recursive: true })
    const temp = file + '.tmp'
    writeFileSync(temp, JSON.stringify(store))
    renameSync(temp, file)
  } catch {
    // The panel is a diagnostic; a failed write must not take the host down.
  }
}

/** Debounced flush, so a busy step writes once. */
function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushStore()
  }, 800)
  if (typeof flushTimer.unref === 'function') flushTimer.unref()
}

/** Load the counter file, creating a fresh state on first run. */
function loadStore() {
  let loaded = null
  try {
    loaded = JSON.parse(readFileSync(storePath(), 'utf8'))
  } catch {
    loaded = null
  }
  const valid = loaded && typeof loaded === 'object' && loaded.skills && typeof loaded.skills === 'object'
  if (valid) {
    store = { version: 1, startedAt: Number(loaded.startedAt) || Date.now(), skills: loaded.skills }
    return
  }
  store = { version: 1, startedAt: Date.now(), skills: {} }
  flushStore()
}

/** Local calendar day key for a timestamp. */
function dayKey(time) {
  const date = new Date(time)
  const pad = (value) => (value < 10 ? '0' + value : String(value))
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/**
 * Record one use.
 * @param skill - skill name.
 * @param kind - `agent` or `user`.
 * @param sessionId - owning session, '' when unknown.
 * @param failed - whether the call failed.
 */
function bump(skill, kind, sessionId, failed) {
  const name = String(skill)
  if (name === '' || name.length > 200) return
  const now = Date.now()
  let entry = store.skills[name]
  if (!entry) {
    entry = { days: {}, last: 0 }
    store.skills[name] = entry
  }
  const day = dayKey(now)
  let bucket = entry.days[day]
  if (!bucket) {
    bucket = { total: 0, agent: 0, user: 0, failed: 0, last: 0, sessions: [] }
    entry.days[day] = bucket
  }
  bucket.total += 1
  if (kind === 'user') bucket.user += 1
  else bucket.agent += 1
  if (failed) bucket.failed += 1
  if (now > bucket.last) bucket.last = now
  if (sessionId !== '' && bucket.sessions.indexOf(sessionId) === -1) bucket.sessions.push(sessionId)
  if (now > entry.last) entry.last = now
  scheduleFlush()
}


/**
 * Aggregate the counter state for one window.
 * @param state - the counter state.
 * @param inventory - installed skill rows.
 * @param window - normalised window name.
 * @returns the API payload.
 */
function buildPayload(state, inventory, window) {
  const cutoff = cutoffFor(window)
  const bySkill = new Map()
  const windowSessions = new Set()
  let calls = 0
  let failedCalls = 0

  for (const [skill, entry] of Object.entries((state && state.skills) || {})) {
    let total = 0
    let agent = 0
    let user = 0
    let failed = 0
    let last = 0
    const sessions = new Set()
    for (const [day, bucket] of Object.entries(entry.days || {})) {
      const dayStart = new Date(day + 'T00:00:00').getTime()
      if (Number.isFinite(dayStart) && dayStart + DAY_MS <= cutoff) continue
      total += bucket.total || 0
      agent += bucket.agent || 0
      user += bucket.user || 0
      failed += bucket.failed || 0
      if (bucket.last > last) last = bucket.last
      for (const id of bucket.sessions || []) sessions.add(id)
    }
    if (total === 0) continue
    calls += total
    failedCalls += failed
    for (const id of sessions) windowSessions.add(id)
    bySkill.set(skill, { total, agent, user, failed, sessions: sessions.size, lastUsed: last })
  }

  const installed = new Set(inventory.map((row) => row.name))
  const rows = inventory.map((row) => {
    const agg = bySkill.get(row.name)
    return {
      ...row,
      total: agg ? agg.total : 0,
      agent: agg ? agg.agent : 0,
      user: agg ? agg.user : 0,
      failed: agg ? agg.failed : 0,
      sessions: agg ? agg.sessions : 0,
      lastUsed: agg ? agg.lastUsed : 0,
      share: agg && calls > 0 ? agg.total / calls : 0,
    }
  })
  rows.sort((a, b) => (b.total - a.total) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const uninstalled = []
  for (const [skill, agg] of bySkill) {
    if (installed.has(skill)) continue
    uninstalled.push({
      name: skill,
      description: '',
      source: 'uninstalled',
      provider: '',
      path: '',
      modelInvocable: false,
      userInvocable: false,
      origin: { kind: 'uninstalled', label: '' },
      ...agg,
      share: calls > 0 ? agg.total / calls : 0,
    })
  }
  uninstalled.sort((a, b) => b.total - a.total)

  const used = rows.filter((row) => row.total > 0).length
  return {
    generatedAt: Date.now(),
    startedAt: state && state.startedAt ? state.startedAt : 0,
    window,
    cutoff,
    totals: {
      installed: rows.length,
      used,
      unused: rows.length - used,
      calls,
      sessions: windowSessions.size,
      failed: failedCalls,
      scannedSessions: 0,
      liveSessions: 0,
      fileSessions: 0,
      skippedSessions: 0,
    },
    skills: rows,
    uninstalled,
  }
}


/**
 * Host plugin body: load the counters, subscribe to the two usage events, and
 * serve the statistics route.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  loadStore()

  ctx.on('skills/change', () => {
    inventoryCache = null
  }, 'dsh-skill-stats: invalidate inventory')

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
        bump(skill, 'agent', sessionId, Boolean(result && result.isError))
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
        bump(skill, 'user', sessionId, false)
      } catch {
        // Counting must never disturb the session.
      }
    },
    'dsh-skill-stats: skill invocations',
  )

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
            const inventory = await readInventory(ctx)
            writeJson(res, 200, buildPayload(store, inventory, window))
          } catch (error) {
            writeJson(res, 500, { error: String((error && error.message) || error) })
          }
        },
      }),
    'dsh-skill-stats: statistics route',
  )

  ctx.effect(() => () => flushStore(), 'dsh-skill-stats: flush counters on unload')
}

export { buildPayload, normalizeWindow, cutoffFor }
