/**
 * The usage tracker: turn-scoped counting over host session events.
 *
 * One user request (a `turn`) yields at most one use of a given skill, however
 * many times the skill is loaded, invoked or mentioned inside that turn. Three
 * signals count:
 *
 *   1. the agent loads the skill (`tool/call` with `name: "skill"`, confirmed by
 *      the matching `tool/result`);
 *   2. the user invokes it as `/name` (`user/message` with
 *      `source.kind === "skill-invocation"`);
 *   3. the user names it again in a later turn, provided it was already loaded
 *      earlier in this session.
 *
 * Everything here is synchronous state folding over events; the only side effect
 * goes through the injected `onUse` callback.
 */

import { mentionsSkill } from './mentions.js'

/** Maximum dedupe keys remembered before the oldest are dropped. */
const SEEN_LIMIT = 4000

/** Maximum finished-call records kept while waiting for results. */
const PENDING_LIMIT = 500

/**
 * Create a tracker.
 * @param options - `{ onUse }`; receives `{ sessionId, skill, kind, failed }`.
 * @returns `{ handle(session, event) }`.
 */
export function createUsageTracker({ onUse }) {
  /** sessionId → { turn, loaded:Set<string> } */
  const sessions = new Map()
  /** callId → { sessionId, turn, skill } */
  const pending = new Map()
  /** `${sessionId}|${turn}|${skill}` */
  const seen = new Set()

  /** Session state, created on demand. */
  function stateOf(sessionId) {
    let state = sessions.get(sessionId)
    if (!state) {
      state = { turn: null, loaded: new Set() }
      sessions.set(sessionId, state)
    }
    return state
  }

  /**
   * Count one use unless this turn already counted the skill.
   * @param use - `{ sessionId, turn, skill, kind, failed }`.
   */
  function countOnce(use) {
    const turn = use.turn === null || use.turn === undefined ? `seq${use.seq}` : String(use.turn)
    const key = use.sessionId + '|' + turn + '|' + use.skill
    if (seen.has(key)) return
    seen.add(key)
    if (seen.size > SEEN_LIMIT) {
      const first = seen.values().next().value
      seen.delete(first)
    }
    onUse({ sessionId: use.sessionId, skill: use.skill, kind: use.kind, failed: Boolean(use.failed) })
  }

  /** Collect the text a user message carries. */
  function messageText(data) {
    if (!data || !Array.isArray(data.content)) return ''
    return data.content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
  }

  /** Parse the skill name out of a `tool/call` argument string. */
  function skillArgument(raw) {
    if (typeof raw !== 'string' || raw === '') return ''
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed.name === 'string' ? parsed.name.trim() : ''
    } catch {
      return ''
    }
  }

  /**
   * Fold one committed session event.
   * @param session - the session the event belongs to.
   * @param event - the committed event.
   */
  function handle(session, event) {
    if (!event || typeof event.type !== 'string') return
    const header = session && session.header
    const sessionId = header && header.id ? String(header.id) : session && session.id ? String(session.id) : ''
    if (sessionId === '') return
    const state = stateOf(sessionId)
    const data = event.data || {}

    if (event.type === 'turn/start') {
      state.turn = typeof data.turn === 'number' ? data.turn : state.turn
      return
    }

    if (event.type === 'tool/call') {
      if (data.name !== 'skill') return
      const skill = skillArgument(data.arguments)
      if (skill === '') return
      state.loaded.add(skill)
      if (typeof data.callId === 'string') {
        pending.set(data.callId, { sessionId, turn: state.turn, skill, seq: event.seq })
        if (pending.size > PENDING_LIMIT) {
          const first = pending.keys().next().value
          pending.delete(first)
        }
      }
      return
    }

    if (event.type === 'tool/result') {
      const message = data.message
      const callId = message && message.toolCallId
      if (typeof callId !== 'string') return
      const call = pending.get(callId)
      if (!call) return
      pending.delete(callId)
      countOnce({
        sessionId: call.sessionId,
        turn: call.turn === null || call.turn === undefined ? data.turn : call.turn,
        seq: event.seq,
        skill: call.skill,
        kind: 'agent',
        failed: Boolean(message.isError),
      })
      return
    }

    if (event.type !== 'user/message') return
    const source = data.source
    if (!source) return

    if (source.kind === 'skill-invocation') {
      const skill = typeof source.name === 'string' ? source.name.trim() : ''
      if (skill === '') return
      state.loaded.add(skill)
      countOnce({ sessionId, turn: state.turn, seq: event.seq, skill, kind: 'user', failed: false })
      return
    }

    if (source.kind !== 'user') return
    const text = messageText(data)
    if (text === '') return
    for (const skill of state.loaded) {
      if (!mentionsSkill(text, skill)) continue
      countOnce({ sessionId, turn: state.turn, seq: event.seq, skill, kind: 'user', failed: false })
    }
  }

  return { handle }
}
