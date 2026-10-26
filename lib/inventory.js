/**
 * The inventory module: which skills are installed, and where each comes from.
 *
 * Behaviour behind the interface: merges four sources (the skills service, disk
 * skill roots, skills shipped inside installed plugin packages, and each agent
 * preset's scope), de-duplicates by name, classifies the origin, and caches the
 * result until something changes. The interface is two calls; callers never see
 * the directories, the package scan, or the caches.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { classifyOrigin, parseSkillFrontmatter } from './skills-md.js'

/** How long a listing is reused before it is rebuilt. */
const CACHE_MS = 60_000

/**
 * Installed plugin package directories, resolved from the profile manifest.
 * @param profileDir - the DSH profile directory, or '' when unknown.
 * @returns `{ dir, packageName }` pairs.
 */
function installedPluginDirs(profileDir, note = () => {}) {
  const dirs = []
  if (typeof profileDir !== 'string' || profileDir === '') return dirs
  let manifest = {}
  try {
    manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  } catch (error) {
    manifest = {}
    if (!(error && error.code === 'ENOENT')) note('inventory.profile-manifest', error)
  }
  const modules = join(profileDir, 'node_modules')
  for (const name of Object.keys(manifest.dependencies || {})) {
    dirs.push({ dir: join(modules, name), packageName: name })
  }
  const local = join(profileDir, 'plugins')
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
 * Every `SKILL.md` under one directory, ignoring nested dependencies.
 * @param dir - directory to scan.
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

/**
 * The `SKILL.md` files a plugin package actually installs. Only the conventional
 * locations are read — a package's own `docs/` can carry example skills that are
 * not part of what it installs.
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
 * Create an inventory reader.
 * @param options - `{ skills, presets?, home, profileDir?, projectDir?, env?, clock? }`.
 * @returns `{ list, invalidate }`.
 */
export function createInventory({
  skills,
  presets,
  dshHome,
  userHome = homedir(),
  profileDir = '',
  projectDir = '',
  env = process.env,
  clock = Date.now,
  diagnostics = null,
}) {
  let inventoryCache = null
  let pluginCache = null

  /** Report a swallowed failure without disturbing the listing. */
  const note = (scope, error) => {
    if (diagnostics) diagnostics.note(scope, error)
  }

  /** Skills shipped inside installed plugin packages. */
  function pluginSkillIndex() {
    if (pluginCache !== null && clock() - pluginCache.at < CACHE_MS) return pluginCache.index
    const index = new Map()
    for (const plugin of installedPluginDirs(profileDir, note)) {
      for (const file of packageSkillFiles(plugin.dir)) {
        let text = ''
        try {
          text = readFileSync(file, 'utf8')
        } catch (error) {
          note('inventory.plugin-skill-read', error)
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
    pluginCache = { at: clock(), index }
    return index
  }

  /** Skill roots outside the skills service. */
  function skillRoots() {
    const roots = [
      { dir: join(dshHome, 'skills'), source: 'user-dsh' },
      { dir: join(userHome, '.agents', 'skills'), source: 'user-agents' },
    ]
    const bundled = env.DSH_BUNDLED_SKILL_DIR
    if (typeof bundled === 'string' && bundled !== '') roots.push({ dir: bundled, source: 'bundled' })
    if (projectDir !== '') {
      roots.push({ dir: join(projectDir, '.dsh', 'skills'), source: 'project-dsh' })
      roots.push({ dir: join(projectDir, '.agents', 'skills'), source: 'project-agents' })
    }
    return roots
  }

  /** Read every `<root>/<name>/SKILL.md` the filesystem offers. */
  function readDiskSkills() {
    const found = new Map()
    for (const root of skillRoots()) {
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
        } catch (error) {
          note('inventory.disk-skill-read', error)
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
   * Read the installed skill inventory.
   * @returns rows, sorted by name, each with an `origin` badge.
   */
  async function list() {
    if (inventoryCache !== null && clock() - inventoryCache.at < CACHE_MS) return inventoryCache.rows

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
      summaries = await skills.list({})
    } catch (error) {
      summaries = []
      note('inventory.skills-service', error)
    }
    for (const summary of summaries) addSummary(summary)

    for (const disk of readDiskSkills()) {
      if (byName.has(disk.name)) continue
      byName.set(disk.name, disk)
    }

    // A plugin's skill can arrive as plain `bundled`; only the file's real
    // location separates it from something DSH itself ships.
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

    // Preset-scoped skills are invisible to the global layer; ask each preset.
    if (presets && typeof presets.list === 'function') {
      try {
        const roster = await presets.list()
        for (const preset of roster) {
          const id = preset && (preset.id || preset.name)
          if (!id) continue
          let scope = null
          try {
            scope = await presets.acquireScope(id)
            for (const summary of await skills.list({ scope: scope.key })) addSummary(summary)
          } catch (error) {
            // A preset that cannot be scoped simply contributes nothing.
            note('inventory.preset-scope', error)
          } finally {
            if (scope && typeof scope[Symbol.asyncDispose] === 'function') {
              try {
                await scope[Symbol.asyncDispose]()
              } catch (error) {
                // Disposal failures must not invalidate a good listing.
                note('inventory.preset-dispose', error)
              }
            }
          }
        }
      } catch {
        // Older hosts without agent presets still get the other three sources.
      }
    }

    const rows = [...byName.values()]
      .map((row) => ({ ...row, origin: classifyOrigin(row) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    inventoryCache = { at: clock(), rows }
    return rows
  }

  /** Drop every cached view, after the skill catalog changed. */
  function invalidate() {
    inventoryCache = null
    pluginCache = null
  }

  return { list, invalidate }
}
