/**
 * Pure helpers for skill files.
 *
 * Everything here is a value-in/value-out function: parsing a `SKILL.md`
 * frontmatter and classifying where a skill came from. They own the rules that
 * produced two real bugs (a CRLF file losing every key, and a plugin skill being
 * labelled as bundled), so they are unit-tested directly.
 */

/**
 * Parse a `SKILL.md` YAML frontmatter well enough for the inventory.
 * Only flat `key: value` lines are needed: name, description, and
 * `disable-model-invocation`.
 * @param text - the whole file.
 * @returns the parsed keys.
 */
export function parseSkillFrontmatter(text) {
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
 * Classify where a skill came from, for the panel's source badge.
 *
 * `source` alone cannot tell a bundle's own skill (archify, browser-skill) from
 * a harness-shipped one, so the resource path is inspected when present:
 * anything under a profile's `node_modules/<pkg>` is that plugin's skill, and
 * DSH's own packages stay `bundled`.
 * @param row - `{ source, provider, path }`.
 * @returns `{ kind, label }` badge kind and optional plugin label.
 */
export function classifyOrigin(row) {
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
    return { kind: 'bundled', label: '' }
  }
  return { kind: 'unknown', label: source || '' }
}
