/**
 * The payload module: turn counter aggregates plus inventory rows into the
 * response the panel reads. Pure — no clock, no IO, no services — so the row
 * shaping, share arithmetic and uninstalled bucket are tested directly.
 */

/**
 * Build the statistics payload.
 * @param {import('./counter.js').Counts} counts - a counter snapshot.
 * @param rows - inventory rows.
 * @param meta - `{ generatedAt: number, diagnostics?: object[] }`.
 * @returns the API payload.
 */
export function buildPayload(counts, rows, meta) {
  const perSkill = counts.perSkill
  const installed = new Set(rows.map((row) => row.name))

  const skills = rows.map((row) => {
    const agg = perSkill.get(row.name)
    return {
      ...row,
      total: agg ? agg.total : 0,
      agent: agg ? agg.agent : 0,
      user: agg ? agg.user : 0,
      failed: agg ? agg.failed : 0,
      sessions: agg ? agg.sessions : 0,
      lastUsed: agg ? agg.lastUsed : 0,
      share: agg && counts.calls > 0 ? agg.total / counts.calls : 0,
    }
  })
  skills.sort((a, b) => (b.total - a.total) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const uninstalled = []
  for (const [skill, agg] of perSkill) {
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
      total: agg.total,
      agent: agg.agent,
      user: agg.user,
      failed: agg.failed,
      sessions: agg.sessions,
      lastUsed: agg.lastUsed,
      share: counts.calls > 0 ? agg.total / counts.calls : 0,
    })
  }
  uninstalled.sort((a, b) => b.total - a.total)

  const used = skills.filter((row) => row.total > 0).length
  return {
    generatedAt: meta.generatedAt,
    startedAt: counts.startedAt || 0,
    window: counts.window,
    cutoff: counts.cutoff,
    totals: {
      installed: skills.length,
      used,
      unused: skills.length - used,
      calls: counts.calls,
      sessions: counts.sessions,
      failed: counts.failed,
    },
    skills,
    uninstalled,
    diagnostics: Array.isArray(meta.diagnostics) ? meta.diagnostics : [],
  }
}
