/**
 * Pure skill-name matching for the "the user named it again" signal.
 *
 * The comparison is deliberately forgiving about the separators people use for
 * the same skill — `code-review`, `code review`, `CodeReview`, `codereview` all
 * name one skill — and deliberately strict about short names, where a substring
 * match would fire on ordinary words (`pr` inside `prepare`).
 */

/**
 * Compact a name or a message: lowercase, letters and digits only.
 * @param text - raw text.
 * @returns the compact form.
 */
export function compact(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Whether a message names a skill.
 *
 * Long names (5+ compact characters) match anywhere in the compacted message, so
 * a Chinese sentence without spaces still hits. Short names must match a whole
 * token, which keeps `pr`, `tdd` and `pr`-like names from firing on ordinary
 * prose.
 * @param text - the user message.
 * @param skillName - the skill name.
 * @returns true when the message names the skill.
 */
export function mentionsSkill(text, skillName) {
  const name = compact(skillName)
  if (name === '' || name.length < 2) return false
  const body = compact(text)
  if (body === '') return false
  if (name.length >= 5) return body.includes(name)
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((token) => token === name)
}
