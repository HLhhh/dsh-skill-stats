/** Shared test helpers: throwaway directories and a controllable clock. */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Create a temporary directory removed by `cleanup`.
 * @param prefix - directory prefix.
 */
export function tempDir(prefix = 'dsh-skill-stats-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * A clock advanced only by the test.
 * @param start - initial epoch milliseconds.
 */
export function fakeClock(start = Date.UTC(2026, 9, 26, 8, 0, 0)) {
  let now = start
  const clock = () => now
  clock.advance = (ms) => {
    now += ms
    return now
  }
  clock.set = (ms) => {
    now = ms
    return now
  }
  return clock
}

/** Write `<dir>/<name>/SKILL.md`. */
export function writeSkill(dir, name, body) {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'SKILL.md'), body)
}
