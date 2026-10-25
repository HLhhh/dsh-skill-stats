/**
 * Host half of `dsh-skill-stats`.
 *
 * One job: answer `GET /dsh-skill-stats/api` with the current skill usage
 * statistics. Every request recomputes from the session logs (a stale answer is
 * the one failure mode this panel must not have), while an mtime/size keyed
 * per-session cache keeps the steady-state cost near zero:
 *
 *  - Sessions that are live are read through `ctx.sessionQuery.readSession`,
 *    which is authoritative including the events not yet flushed to disk.
 *  - Finished sessions are read from their `session.v4.jsonl.zstd` file, and
 *    only lines that can possibly carry usage are JSON-parsed.
 *  - The installed-skill inventory comes from `ctx.skills.list()`, which is
 *    invocation-neutral: it includes `/name`-only skills too.
 *
 * "Usage" is exactly the two signals the user asked for: an Agent calling the
 * `skill` tool (arguments.name), and a user message whose `source.kind` is
 * `skill-invocation` (a `/name` invocation). Nothing else counts.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Stable Loader identity, following the shipped tool plugins. */
export const name = 'dsh-skill-stats'

/** Services the host half needs; a composition without them leaves the row inactive. */
export const inject = ['webServer', 'skills', 'sessionQuery']

/** Route the browser half reads. Same-origin, so the GUI's own auth applies. */
export const ROUTE = '/dsh-skill-stats/api'

/** How long one scan is reused: long enough to absorb a page's parallel requests. */
const SCAN_TTL_MS = 400

/** One day in milliseconds. */
const DAY_MS = 86_400_000

/** The DSH home this process runs against. */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * Index every persisted session file by session id.
 *
 * The layout is `<DSH_HOME>/sessions/<workspace>/<sessionId>/session.v4.jsonl.zstd`.
 * A missing or unreadable tree yields an empty index; the live path still works.
 * @returns {Map<string, string>} session id → absolute file path.
 */
function indexSessionFiles() {
  const files = new Map()
  const root = join(dshHome(), 'sessions')
  let buckets = []
  try {
    buckets = readdirSync(root)
  } catch {
    return files
  }
  for (const bucket of buckets) {
    const bucketPath = join(root, bucket)
    try {
      if (!statSync(bucketPath).isDirectory()) continue
    } catch {
      continue
    }
    let ids = []
    try {
      ids = readdirSync(bucketPath)
    } catch {
      continue
    }
    for (const id of ids) {
      const file = join(bucketPath, id, 'session.v4.jsonl.zstd')
      try {
        if (!statSync(file).isFile()) continue
      } catch {
        continue
      }
      files.set(id, file)
    }
  }
  return files
}

/**
 * Parse the skill names out of one `tool/call` line's arguments.
 * @param raw - the JSON string the event carries.
 * @returns the requested skill name, or '' when it cannot be read.
 */
function skillNameFromArguments(raw) {
  if (typeof raw !== 'string' || raw === '') return ''
  try {
    const parsed = JSON.parse(raw)
    const value = parsed && typeof parsed.name === 'string' ? parsed.name.trim() : ''
    return value
  } catch {
    return ''
  }
}

/**
 * Fold one session's events into usage records.
 *
 * Accepts both real event objects (live sessions) and raw JSONL text (persisted
 * sessions) so the two paths cannot drift apart.
 * @param events - live event array, or null when reading text.
 * @param text - decompressed JSONL, or null when reading events.
 * @param sessionId - owning session.
 * @param header - session header (sub-agent detection).
 * @returns {{ usages: object[], failed: Set<string> }}
 */
function foldSession(events, text, sessionId, header) {
  const usages = []
  const failed = new Set()
  const catalog = []
  const createdAt = header && typeof header.createdAt === 'number' ? header.createdAt : 0
  const subagent = Boolean(header && (header.parentSession || header.origin === 'subagent' || (header.delegationDepth || 0) > 0))

  /** Handle one decoded event. */
  const handle = (event) => {
    if (!event || typeof event.type !== 'string') return
    // A forked/continued session log replays the parent's events ahead of its
    // own. Those copies happened before this session existed, so they belong to
    // the parent's count and must not be added again here.
    if (createdAt > 0 && typeof event.time === 'number' && event.time < createdAt) return
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (event.type === 'tool/call') {
      if (data.name !== 'skill') return
      const skill = skillNameFromArguments(data.arguments)
      if (skill === '') return
      usages.push({
        skill,
        time: typeof event.time === 'number' ? event.time : 0,
        sessionId,
        kind: 'agent',
        callId: typeof data.callId === 'string' ? data.callId : '',
        subagent,
      })
      return
    }
    if (event.type === 'tool/result') {
      const message = data.message
      const isError = Boolean((message && message.isError === true) || data.error)
      if (!isError) return
      const callId = (message && (message.toolCallId || (message.source && message.source.callId))) || ''
      if (typeof callId === 'string' && callId !== '') failed.add(callId)
      return
    }
    if (event.type === 'user/message') {
      const source = data.source
      if (source && source.kind === 'skill-catalog' && Array.isArray(source.entries)) {
        for (const entry of source.entries) {
          if (entry && typeof entry.name === 'string' && entry.name !== '') {
            catalog.push({ name: entry.name, description: typeof entry.description === 'string' ? entry.description : '' })
          }
        }
        return
      }
      if (!source || source.kind !== 'skill-invocation') return
      const skill = typeof source.name === 'string' ? source.name.trim() : ''
      if (skill === '') return
      usages.push({
        skill,
        time: typeof event.time === 'number' ? event.time : 0,
        sessionId,
        kind: 'user',
        callId: '',
        subagent,
      })
    }
  }

  if (Array.isArray(events)) {
    for (const event of events) handle(event)
    return { usages, failed, catalog }
  }

  // Raw JSONL: only lines that can carry a relevant event are parsed. The whole
  // file is decompressed either way, but JSON parsing is the expensive half.
  const lines = String(text).split('\n')
  for (const line of lines) {
    if (line === '') continue
    const maybeCall = line.indexOf('"tool/call"') !== -1 && line.indexOf('"skill"') !== -1
    const maybeResult = line.indexOf('"tool/result"') !== -1 && line.indexOf('"isError":true') !== -1
    const maybeUser = line.indexOf('"skill-invocation"') !== -1
    const maybeCatalog = line.indexOf('"skill-catalog"') !== -1
    if (!maybeCall && !maybeResult && !maybeUser && !maybeCatalog) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    handle(event)
  }
  return { usages, failed, catalog }
}

/**
 * Mark the usage records whose call failed.
 * @param usages - records from one session.
 * @param failed - failed call ids from the same session.
 * @returns the same array, annotated.
 */
function annotateFailures(usages, failed) {
  if (failed.size === 0) return usages
  for (const usage of usages) {
    if (usage.callId !== '' && failed.has(usage.callId)) usage.failed = true
  }
  return usages
}

/** Per-session parse cache: appended files invalidate on size or mtime change. */
const fileCache = new Map()

/**
 * Drop copies of the same usage seen in more than one session log.
 *
 * Forked sessions replay the parent's events, so a strict line count can count
 * one call twice. A tool call id is globally unique, and an inherited user
 * invocation keeps its original timestamp, so both forms dedupe exactly.
 * @param list - usage records from every session.
 * @returns the deduplicated list.
 */
function dedupeUsages(list) {
  const seen = new Set()
  const out = []
  for (const usage of list) {
    const key =
      usage.kind === 'agent'
        ? usage.callId
          ? 'a:' + usage.callId
          : 'x:' + usage.sessionId + ':' + usage.time
        : 'u:' + usage.skill + ':' + usage.time
    if (seen.has(key)) continue
    seen.add(key)
    out.push(usage)
  }
  return out
}

/**
 * Read one persisted session file, reusing its parse when unchanged.
 * @param id - session id.
 * @param file - absolute path.
 * @param header - session header, used only for sub-agent detection.
 * @returns {{ usages: object[], failed: Set<string> } | null}
 */
function readPersisted(id, file, header) {
  let info
  try {
    info = statSync(file)
  } catch {
    return null
  }
  const cached = fileCache.get(id)
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
    return { usages: cached.usages, failed: cached.failed }
  }
  let text
  try {
    text = zstdDecompressSync(readFileSync(file)).toString('utf8')
  } catch {
    return null
  }
  const folded = foldSession(null, text, id, header)
  fileCache.set(id, {
    size: info.size,
    mtimeMs: info.mtimeMs,
    usages: folded.usages,
    failed: folded.failed,
  })
  return folded
}


/**
 * Parse a `SKILL.md` YAML frontmatter well enough for the inventory.
 * Only flat `key: value` lines are needed: name, description, and
 * `disable-model-invocation`.
 * @param text - the whole file.
 * @returns the parsed keys.
 */
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
async function readInventory(ctx, cwds, catalogHints) {
  const byName = new Map()
  let summaries = []
  try {
    summaries = await ctx.skills.list({})
  } catch {
    summaries = []
  }
  for (const summary of summaries) {
    if (!summary || typeof summary.name !== 'string' || byName.has(summary.name)) continue
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
  // Filesystem rows fill whatever the scoped service could not report.
  for (const disk of readDiskSkills(cwds || [])) {
    if (byName.has(disk.name)) continue
    byName.set(disk.name, disk)
  }
  // Skills shipped inside installed plugin packages. When the service reports one
  // as `bundled` without a path, this is what tells the panel it came from a
  // plugin rather than from DSH itself.
  const plugins = pluginSkillIndex()
  for (const row of byName.values()) {
    const hit = plugins.get(row.name)
    if (!hit) continue
    if (row.path === '') row.path = hit.path
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
  // The per-session catalog snapshot names plugin/preset-skills the service did
  // not expose to this scope. Everything in it is model-invocable by definition.
  for (const hint of catalogHints || []) {
    if (byName.has(hint.name)) continue
    byName.set(hint.name, {
      name: hint.name,
      description: hint.description,
      source: 'bundled',
      provider: 'session-catalog',
      path: '',
      modelInvocable: true,
      userInvocable: true,
    })
  }
  return [...byName.values()]
    .map((row) => ({ ...row, origin: classifyOrigin(row) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * One full scan: inventory + every session's usage records.
 * @param ctx - host plugin context.
 * @returns {Promise<object>} the scan snapshot.
 */
async function scanAll(ctx) {
  const startedAt = Date.now()
  const t0 = performance.now()
  const files = indexSessionFiles()
  const records = await ctx.sessionQuery.listSessions()
  const cwds = [...new Set(records.map((record) => (record && record.header ? record.header.cwd : '')).filter((cwd) => typeof cwd === 'string' && cwd !== ''))]
  const usages = []
  const hints = new Map()
  let liveSessions = 0
  let fileSessions = 0
  let skipped = 0
  let lastYield = performance.now()

  for (const record of records) {
    const header = record && record.header ? record.header : null
    if (!header || typeof header.id !== 'string') continue
    const id = header.id
    const file = files.get(id)
    try {
      if (record.live) {
        liveSessions += 1
        const snapshot = await ctx.sessionQuery.readSession(header.id)
        const folded = foldSession(snapshot.events, null, id, snapshot.session || header)
        usages.push(...annotateFailures(folded.usages, folded.failed))
        for (const hint of folded.catalog) if (!hints.has(hint.name)) hints.set(hint.name, hint)
      } else if (file) {
        fileSessions += 1
        const folded = readPersisted(id, file, header)
        if (folded === null) {
          skipped += 1
          continue
        }
        usages.push(...annotateFailures(folded.usages, folded.failed))
        for (const hint of folded.catalog) if (!hints.has(hint.name)) hints.set(hint.name, hint)
      } else {
        skipped += 1
      }
    } catch {
      skipped += 1
    }
    // Keep the host responsive: one scan is many files, and a long synchronous
    // stretch would stall the GUI's other work.
    if (performance.now() - lastYield > 25) {
      lastYield = performance.now()
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  const inventory = await readInventory(ctx, cwds, [...hints.values()])

  return {
    startedAt,
    scanMs: Math.round(performance.now() - t0),
    sessions: records.length,
    liveSessions,
    fileSessions,
    skipped,
    inventory,
    usages: dedupeUsages(usages),
  }
}

/** Shared scan cache: one scan feeds every window asked for within its TTL. */
let cachedScan = null
let inFlight = null

/**
 * Get a scan no older than {@link SCAN_TTL_MS}.
 * @param ctx - host plugin context.
 * @returns {Promise<object>} the scan snapshot.
 */
async function currentScan(ctx) {
  if (cachedScan !== null && Date.now() - cachedScan.at < SCAN_TTL_MS) return cachedScan.scan
  if (inFlight !== null) return inFlight
  inFlight = (async () => {
    const scan = await scanAll(ctx)
    cachedScan = { at: Date.now(), scan }
    return scan
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/**
 * Inclusive cutoff for a window name.
 * @param window - `all` | `today` | `7d` | `30d`.
 * @returns epoch milliseconds.
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
function buildPayload(scan, window) {
  const cutoff = cutoffFor(window)
  const bySkill = new Map()
  const windowSessions = new Set()
  let calls = 0
  let failedCalls = 0
  let subagentCalls = 0

  for (const usage of scan.usages) {
    if (usage.time < cutoff) continue
    calls += 1
    if (usage.failed) failedCalls += 1
    if (usage.subagent) subagentCalls += 1
    windowSessions.add(usage.sessionId)
    let row = bySkill.get(usage.skill)
    if (!row) {
      row = { total: 0, agent: 0, user: 0, failed: 0, subagent: 0, lastUsed: 0, sessions: new Set() }
      bySkill.set(usage.skill, row)
    }
    row.total += 1
    if (usage.kind === 'user') row.user += 1
    else row.agent += 1
    if (usage.failed) row.failed += 1
    if (usage.subagent) row.subagent += 1
    if (usage.time > row.lastUsed) row.lastUsed = usage.time
    row.sessions.add(usage.sessionId)
  }

  const installed = new Set(scan.inventory.map((row) => row.name))
  const skills = scan.inventory.map((row) => {
    const agg = bySkill.get(row.name)
    return {
      ...row,
      total: agg ? agg.total : 0,
      agent: agg ? agg.agent : 0,
      user: agg ? agg.user : 0,
      failed: agg ? agg.failed : 0,
      subagent: agg ? agg.subagent : 0,
      sessions: agg ? agg.sessions.size : 0,
      lastUsed: agg ? agg.lastUsed : 0,
      share: agg && calls > 0 ? agg.total / calls : 0,
    }
  })
  skills.sort((a, b) => (b.total - a.total) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const uninstalled = []
  for (const [skill, agg] of bySkill) {
    if (installed.has(skill)) continue
    uninstalled.push({
      name: skill,
      total: agg.total,
      agent: agg.agent,
      user: agg.user,
      failed: agg.failed,
      subagent: agg.subagent,
      sessions: agg.sessions.size,
      lastUsed: agg.lastUsed,
      share: calls > 0 ? agg.total / calls : 0,
      source: 'uninstalled',
      provider: '',
      path: '',
      description: '',
      modelInvocable: false,
      userInvocable: false,
      origin: { kind: 'uninstalled', label: '' },
    })
  }
  uninstalled.sort((a, b) => b.total - a.total)

  const used = skills.filter((row) => row.total > 0).length

  return {
    generatedAt: Date.now(),
    scanMs: scan.scanMs,
    window,
    cutoff,
    totals: {
      installed: skills.length,
      used,
      unused: skills.length - used,
      calls,
      sessions: windowSessions.size,
      failed: failedCalls,
      subagent: subagentCalls,
      scannedSessions: scan.sessions,
      liveSessions: scan.liveSessions,
      fileSessions: scan.fileSessions,
      skippedSessions: scan.skipped,
    },
    skills,
    uninstalled,
  }
}

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
 * Host plugin body: register the statistics route.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
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
            const scan = await currentScan(ctx)
            writeJson(res, 200, buildPayload(scan, window))
          } catch (error) {
            writeJson(res, 500, { error: String((error && error.message) || error) })
          }
        },
      }),
    'dsh-skill-stats: statistics route',
  )
}

// Exported for focused tests / diagnostics; not part of the route contract.
export { scanAll, buildPayload, foldSession, normalizeWindow, cutoffFor }
