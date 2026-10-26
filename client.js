/**
 * Browser half of `dsh-skill-stats`.
 *
 * Two contributions, the shape the shipped sidebar panels use:
 *  - `sidebar.panellist` — the icon row that selects the panel.
 *  - `main` (keyed by the same id) — the full centre-column panel body.
 *
 * Design notes:
 *  - Every colour is one of the theme's own aliases (`--dsw-alias-*`); muted
 *    shades are derived with `color-mix` from those aliases, so light, dark, and
 *    future themes all stay correct instead of falling back to a literal.
 *  - The page reads as one quiet document: a title band, a row of four figures,
 *    a toolbar, then a dense table. Accent colour is spent only on the share
 *    bars and the active control.
 *  - Nothing is fetched once and kept: the panel scans on open and every five
 *    seconds after, and keeps the previous rows on screen while refreshing so
 *    the table never flickers or loses scroll position.
 */

window.__ModuleLoader__.load({
  id: 'dsh-skill-stats',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Sidebar entry id and `main` slot key — the same value links the two. */
    const PANEL_ID = 'skill-stats'
    /** Locale namespace owned by this plugin. */
    const NS = 'dshSkillUsage'
    /** Host route returning the statistics. */
    const API = '/dsh-skill-stats/api'
    /** Auto-refresh period while the panel is open. */
    const POLL_MS = 5000

    const CSS = `
.su-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary, #12141a);
  background: var(--dsw-alias-bg-base, #ffffff);
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
.su-root *, .su-root *::before, .su-root *::after { box-sizing: border-box; }

/* ── title band ─────────────────────────────────────────────────────────── */
.su-head {
  flex: 0 0 auto;
  padding: 20px 28px 16px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border-bottom: 1px solid var(--dsw-alias-border-l1, #eceef1);
}
.su-title {
  margin: 3px 0 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.002em;
}
.su-lede {
  margin: 6px 0 0;
  max-width: 660px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #5b6169);
}
.su-figures {
  display: flex;
  flex-wrap: wrap;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}
.su-figure {
  padding: 0 20px;
  border-left: 1px solid var(--dsw-alias-border-l1, #eceef1);
}
.su-figure:first-child { padding-left: 0; border-left: 0; }
.su-figure b {
  display: block;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.su-figure span {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 80%, transparent);
}
.su-figure small {
  margin-left: 5px;
  font-size: 11px;
  font-weight: 400;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 72%, transparent);
}

/* ── toolbar ────────────────────────────────────────────────────────────── */
.su-tools {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 28px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border-bottom: 1px solid var(--dsw-alias-border-l1, #eceef1);
}
.su-seg {
  display: inline-flex;
  gap: 1px;
  padding: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f4f5f7);
  border: 1px solid var(--dsw-alias-border-l1, #eceef1);
}
.su-seg button {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 3px 10px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #5b6169);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.su-seg button:hover { color: var(--dsw-alias-label-primary, #12141a); }
.su-seg button[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary, #12141a);
  background: var(--dsw-alias-bg-base, #ffffff);
  border-color: var(--dsw-alias-border-l2, #dcdfe4);
}
.su-search {
  flex: 1 1 180px;
  max-width: 320px;
  min-width: 140px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, #dcdfe4);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #12141a);
  font: inherit;
  font-size: 12px;
}
.su-search::placeholder {
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 70%, transparent);
}
.su-search:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary, #4a6cf7);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4a6cf7) 16%, transparent);
}
.su-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 2px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #5b6169);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.su-check:hover { color: var(--dsw-alias-label-primary, #12141a); }
.su-check input { margin: 0; accent-color: var(--dsw-alias-brand-primary, #4a6cf7); }
.su-spacer { flex: 1 1 auto; }
.su-checks { display: inline-flex; align-items: center; gap: 12px; }
.su-status { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
.su-updated {
  font-size: 11px;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 74%, transparent);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.su-live {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 5px;
  border-radius: 50%;
  vertical-align: 1px;
  background: var(--dsw-alias-state-success-primary, #1f9d63);
  opacity: 0.75;
}
.su-live[data-busy="true"] {
  background: var(--dsw-alias-state-warn-primary, #c98a00);
  animation: su-pulse 900ms ease-in-out infinite;
}
@keyframes su-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
.su-ghost {
  appearance: none;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, #dcdfe4);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-secondary, #5b6169);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.su-ghost:hover {
  color: var(--dsw-alias-label-primary, #12141a);
  background: var(--dsw-alias-bg-layer-2, #f4f5f7);
}

/* ── table ──────────────────────────────────────────────────────────────── */
.su-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  background: var(--dsw-alias-bg-base, #ffffff);
}
.su-grid {
  display: grid;
  grid-template-columns:
    minmax(220px, 1fr)
    minmax(120px, 232px)
    84px
    64px
    168px
    96px;
  align-items: center;
  column-gap: 18px;
  padding: 0 28px;
}
.su-thead {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 32px;
  background: var(--dsw-alias-bg-layer-2, #f4f5f7);
  border-bottom: 1px solid var(--dsw-alias-border-l1, #eceef1);
}
.su-th {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 78%, transparent);
}
.su-th button {
  appearance: none;
  border: 0;
  padding: 6px 0;
  background: transparent;
  font: inherit;
  font-size: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.su-th button:hover { color: var(--dsw-alias-label-primary, #12141a); }
.su-th button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4a6cf7); outline-offset: 2px; border-radius: 4px; }
.su-th button[data-sorted="true"] { color: var(--dsw-alias-label-primary, #12141a); }
.su-caret { margin-left: 4px; font-size: 9px; opacity: 0.8; }
.su-cell--end { text-align: right; }
.su-th.su-cell--end button { text-align: right; }

.su-row {
  height: 50px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #f0f1f3);
  transition: background 110ms ease;
}
.su-row:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary, #12141a) 3%, transparent); }
.su-row:last-child { border-bottom: 0; }

.su-name { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.su-name b {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}
.su-name b em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
}
.su-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 78%, transparent);
}
.su-tag {
  flex: 0 0 auto;
  padding: 0 5px;
  border: 1px solid var(--dsw-alias-border-l2, #dcdfe4);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  line-height: 15px;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 85%, transparent);
}

.su-origin { display: flex; align-items: center; gap: 6px; min-width: 0; }
.su-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary, #b3bac2);
}
.su-dot--self { background: var(--dsw-alias-brand-primary, #4a6cf7); }
.su-dot--plugin { background: var(--dsw-alias-state-success-primary, #1f9d63); }
.su-dot--project { background: var(--dsw-alias-state-idle-primary, #8a9099); }
.su-dot--office { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4a6cf7) 55%, transparent); }
.su-dot--uninstalled { background: var(--dsw-alias-state-warn-primary, #c98a00); }
.su-origin span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #5b6169);
}
.su-num {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.su-num[data-zero="true"] { color: color-mix(in srgb, var(--dsw-alias-label-primary, #12141a) 32%, transparent); }
.su-fail {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: 5px;
  border-radius: 50%;
  vertical-align: 2px;
  background: var(--dsw-alias-state-error-primary, #d63b3b);
}
.su-cell--end { font-variant-numeric: tabular-nums; }

.su-share { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
.su-track {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, #eceef1);
  overflow: hidden;
  min-width: 72px;
}
.su-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4a6cf7) 82%, transparent);
}
.su-pct {
  min-width: 40px;
  text-align: right;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #5b6169);
  font-variant-numeric: tabular-nums;
}
.su-when {
  text-align: right;
  font-size: 11.5px;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 82%, transparent);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.su-when[data-never="true"] {
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 62%, transparent);
}
.su-when i {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 5px;
  border-radius: 50%;
  vertical-align: 1px;
  background: var(--dsw-alias-state-warn-primary, #c98a00);
  opacity: 0.8;
}

/* ── states ─────────────────────────────────────────────────────────────── */
.su-state {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 56px 24px;
  text-align: center;
}
.su-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 64px 24px;
  text-align: center;
}
.su-empty h3 { margin: 0; font-size: 14px; font-weight: 600; }
.su-empty p { margin: 0; max-width: 420px; font-size: 12px; color: var(--dsw-alias-label-secondary, #5b6169); }
.su-state h3 { margin: 0; font-size: 14px; font-weight: 600; }
.su-state p { margin: 0; max-width: 420px; font-size: 12px; color: var(--dsw-alias-label-secondary, #5b6169); }
.su-skeletons { padding: 4px 0 0; }
.su-loading { margin: 0; padding: 10px 28px 2px; font-size: 11.5px; color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 78%, transparent); }
.su-sk {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(120px, 232px) 84px 64px 168px 96px;
  align-items: center;
  column-gap: 18px;
  height: 50px;
  padding: 0 28px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #f0f1f3);
}
.su-sk i {
  display: block;
  height: 10px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #12141a) 7%, transparent);
  animation: su-breathe 1.4s ease-in-out infinite;
}
.su-sk i:nth-child(2) { width: 70%; animation-delay: 80ms; }
.su-sk i:nth-child(3) { width: 40%; animation-delay: 160ms; }
.su-sk i:nth-child(4) { width: 55%; animation-delay: 240ms; }
.su-sk i:nth-child(5) { width: 80%; animation-delay: 320ms; }
.su-sk i:nth-child(6) { width: 60%; animation-delay: 400ms; }
@keyframes su-breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
.su-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 28px 0;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #d63b3b) 32%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d63b3b) 7%, transparent);
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary, #12141a);
}
.su-banner span { flex: 1 1 auto; }

/* ── footer ─────────────────────────────────────────────────────────────── */
.su-foot {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 28px;
  border-top: 1px solid var(--dsw-alias-border-l1, #eceef1);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  font-size: 11px;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary, #5b6169) 76%, transparent);
}
.su-foot .su-spacer { flex: 1 1 auto; }
.su-checks { display: inline-flex; align-items: center; gap: 12px; }
.su-status { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }

@media (max-width: 960px) {
  .su-head, .su-tools, .su-foot { padding-left: 18px; padding-right: 18px; }
  .su-grid {
    grid-template-columns: minmax(160px, 1.9fr) 92px 64px minmax(100px, 120px);
    column-gap: 12px;
    padding: 0 18px;
  }
  .su-col-origin, .su-col-last { display: none; }
  .su-search { flex: 0 1 180px; max-width: 180px; }
  .su-status { margin-left: 0; }
}
`

    const zh = {
      title: 'Skill 使用统计',
      lede: '从插件启用那一刻开始计数：只认 agent 调 skill 工具，或你用 /name 直呼。启用前的历史不计，也不读会话日志。',
      installed: '已装',
      used: '用过',
      unused: '从未使用',
      calls: '总调用',
      sessionsUsed: '涉及会话',
      windowLabel: '时间范围',
      windowAll: '全部',
      windowToday: '今日',
      window7d: '7 天',
      window30d: '30 天',
      originAll: '全部来源',
      originSelf: '我装的',
      originPlugin: '插件',
      originBundled: '内置',
      originOffice: 'Office',
      originUninstalled: '已卸载',
      originProject: '项目',
      originUnknown: '其他',
      onlyUnused: '只看从未使用',
      showUninstalled: '含已卸载',
      search: '搜索 skill',
      refresh: '刷新',
      colSkill: 'Skill',
      colOrigin: '来源',
      colCalls: '调用',
      colSessions: '会话',
      colShare: '占比',
      colLast: '最后使用',
      onlyManual: '手动',
      neverUsed: '从未使用',
      loadingTitle: '正在扫描会话日志',
      errorTitle: '读取统计失败',
      retry: '重试',
      emptyTitle: '还没有任何 skill 被使用过',
      emptyHint: '当 agent 调用 skill 工具、或你用 /name 调用某个 skill 之后，这里就会出现记录。',
      noMatchTitle: '没有符合筛选的 skill',
      noMatchHint: '换个时间窗或来源试试，也可以清空搜索词。',
      updated: '更新于 {time}',
      busy: '更新中',
      started: '统计自 {time}',
      footerRule: '占比 = 该 skill 调用次数 ÷ 当前筛选下的总调用次数',
      footerHint2: '仅统计启用后的使用 · 打开期间每 5 秒刷新',
      failedTitle: '{n} 次调用出错',
      shareNever: '—',
      originTitle: '来源',
    }

    const en = {
      title: 'Skill usage',
      lede: 'Counting starts when the plugin is first enabled: an agent calling the skill tool, or you invoking /name. Nothing before that counts, and no session log is read.',
      installed: 'Installed',
      used: 'Used',
      unused: 'Never used',
      calls: 'Total calls',
      sessionsUsed: 'Sessions used',
      windowLabel: 'Time range',
      windowAll: 'All',
      windowToday: 'Today',
      window7d: '7 days',
      window30d: '30 days',
      originAll: 'All sources',
      originSelf: 'Installed by me',
      originPlugin: 'Plugins',
      originBundled: 'Bundled',
      originOffice: 'Office',
      originUninstalled: 'Uninstalled',
      originProject: 'Project',
      originUnknown: 'Other',
      onlyUnused: 'Never used only',
      showUninstalled: 'Include uninstalled',
      search: 'Search skills',
      refresh: 'Refresh',
      colSkill: 'Skill',
      colOrigin: 'Source',
      colCalls: 'Calls',
      colSessions: 'Sessions',
      colShare: 'Share',
      colLast: 'Last used',
      onlyManual: 'manual',
      neverUsed: 'Never used',
      loadingTitle: 'Scanning session logs',
      errorTitle: 'Could not read the statistics',
      retry: 'Retry',
      emptyTitle: 'No skill has been used yet',
      emptyHint: 'Once an agent calls the skill tool, or you invoke a skill with /name, it shows up here.',
      noMatchTitle: 'No skill matches these filters',
      noMatchHint: 'Try another time window or source, or clear the search box.',
      updated: 'Updated {time}',
      busy: 'Updating',
      started: 'Counting since {time}',
      footerRule: 'Share = this skill’s calls ÷ total calls in the current filter',
      footerHint2: 'Only uses after enablement · refreshes every 5 s while open',
      failedTitle: '{n} failed calls',
      shareNever: '—',
      originTitle: 'Source',
    }

    /** Translate one key, substituting `{name}` placeholders. */
    function tr(t, key, params) {
      const raw = typeof t === 'function' ? t(key) : key
      const text = typeof raw === 'string' && raw !== key ? raw : key
      if (!params) return text
      return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
    }

    /** Two-digit pad. */
    function pad2(value) {
      return value < 10 ? '0' + value : String(value)
    }

    /** `YYYY-MM-DD HH:MM` for the counting-start line. */
    function formatStamp(time) {
      if (!time) return '—'
      const date = new Date(time)
      return (
        date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes())
      )
    }

    /** `HH:MM:SS` for the refresh stamp. */
    function clockOf(time) {
      const date = new Date(time)
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
    }

    /** A day-aware timestamp for the last-used column. */
    function formatWhen(time, never) {
      if (!time) return never
      const date = new Date(time)
      const now = new Date()
      const sameDay =
        date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
      if (sameDay) return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
      if (date.getFullYear() === now.getFullYear()) {
        return pad2(date.getMonth() + 1) + '/' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes())
      }
      return date.getFullYear() + '/' + pad2(date.getMonth() + 1) + '/' + pad2(date.getDate())
    }

    /** Thousands-separated count. */
    function fmt(value) {
      return typeof value === 'number' ? value.toLocaleString() : String(value)
    }

    /** Percentage of the current filter's total calls. */
    function percent(share) {
      const value = Math.max(0, Math.min(1, Number(share) || 0)) * 100
      if (value <= 0) return '0%'
      if (value < 10) return value.toFixed(1) + '%'
      return Math.round(value) + '%'
    }

    /** Badge kind → dot modifier class. */
    const ORIGIN_CLASS = {
      self: 'self',
      plugin: 'plugin',
      bundled: 'bundled',
      office: 'office',
      project: 'project',
      uninstalled: 'uninstalled',
      unknown: 'unknown',
    }

    /** Localised origin text; plugin rows carry the package name. */
    function originText(t, row) {
      const origin = row.origin && typeof row.origin.kind === 'string' ? row.origin : { kind: 'unknown', label: row.source || '' }
      if (origin.kind === 'plugin') return origin.label || tr(t, 'originPlugin')
      const keys = {
        self: 'originSelf',
        bundled: 'originBundled',
        office: 'originOffice',
        project: 'originProject',
        uninstalled: 'originUninstalled',
      }
      const key = keys[origin.kind]
      if (key) return tr(t, key)
      return origin.label || tr(t, 'originUnknown')
    }

    /** Fetch one window's statistics. */
    async function fetchStats(windowKey) {
      const response = await window.fetch(API + '?window=' + encodeURIComponent(windowKey), {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok) throw new Error(body && body.error ? body.error : 'HTTP ' + response.status)
      if (!body || typeof body !== 'object' || body.error) throw new Error(body && body.error ? body.error : 'empty response')
      return body
    }

    /** Sidebar icon: three ascending bars over a skill spark. */
    function SkillUsageIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { key: 'a', x: 12, y: 38, width: 9, height: 14, rx: 2.5, stroke: 'currentColor', strokeWidth: 3 }),
        h('rect', { key: 'b', x: 27.5, y: 29, width: 9, height: 23, rx: 2.5, stroke: 'currentColor', strokeWidth: 3 }),
        h('rect', { key: 'c', x: 43, y: 20, width: 9, height: 32, rx: 2.5, stroke: 'currentColor', strokeWidth: 3 }),
        h('path', { key: 'd', d: 'M13 10h9M17.5 5.5v9', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', opacity: 0.7 }),
      )
    }

    /** A segmented choice. */
    function Segmented(props) {
      return h(
        'div',
        { className: 'su-seg', role: 'group', 'aria-label': props.label || '' },
        props.options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              'aria-pressed': props.value === option.value ? 'true' : 'false',
              onClick: () => props.onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    /** One column header. */
    function HeadCell(props) {
      const sorted = props.active
      return h(
        'div',
        {
          className: 'su-th' + (props.end ? ' su-cell--end' : '') + (props.className ? ' ' + props.className : ''),
          role: 'columnheader',
          'aria-sort': sorted ? (props.direction === 'asc' ? 'ascending' : 'descending') : 'none',
        },
        h(
          'button',
          { type: 'button', 'data-sorted': sorted ? 'true' : 'false', onClick: props.onSort },
          props.label,
          sorted ? h('span', { className: 'su-caret', 'aria-hidden': true }, props.direction === 'asc' ? '▲' : '▼') : null,
        ),
      )
    }

    /** One skill row. */
    function Row(props) {
      const row = props.row
      const t = props.t
      const origin = row.origin && typeof row.origin.kind === 'string' ? row.origin : { kind: 'unknown', label: '' }
      const unused = !row.total
      const manualOnly = row.modelInvocable === false
      return h(
        'div',
        { className: 'su-grid su-row', role: 'row' },
        h(
          'div',
          { className: 'su-name', role: 'cell' },
          h(
            'b',
            null,
            h('em', { title: row.name }, row.name),
            manualOnly ? h('span', { className: 'su-tag' }, tr(t, 'onlyManual')) : null,
          ),
          row.description ? h('span', { title: row.description }, row.description) : null,
        ),
        h(
          'div',
          { className: 'su-origin su-col-origin', role: 'cell' },
          h('i', { className: 'su-dot su-dot--' + (ORIGIN_CLASS[origin.kind] || 'unknown'), 'aria-hidden': true }),
          h('span', { title: origin.label || originText(t, row) }, originText(t, row)),
        ),
        h(
          'div',
          { className: 'su-num', role: 'cell', 'data-zero': unused ? 'true' : 'false' },
          fmt(row.total),
          row.failed > 0
            ? h('i', { className: 'su-fail', title: tr(t, 'failedTitle', { n: row.failed }), 'aria-hidden': true })
            : null,
        ),
        h(
          'div',
          { className: 'su-num su-cell--end', role: 'cell', 'data-zero': unused ? 'true' : 'false' },
          unused ? '—' : fmt(row.sessions),
        ),
        h(
          'div',
          { className: 'su-share', role: 'cell' },
          unused
            ? null
            : h(
                'div',
                { className: 'su-track', 'aria-hidden': true },
                h('div', { className: 'su-fill', style: { width: Math.max(2, Math.round((row.share || 0) * 100)) + '%' } }),
              ),
          h('span', { className: 'su-pct' }, unused ? tr(t, 'shareNever') : percent(row.share)),
        ),
        h(
          'div',
          { className: 'su-when su-col-last', role: 'cell', 'data-never': unused ? 'true' : 'false' },
          unused ? h('i', { 'aria-hidden': true }) : null,
          formatWhen(row.lastUsed, tr(t, 'neverUsed')),
        ),
      )
    }

    /** Loading skeleton with a quiet caption. */
    function Skeleton(props) {
      const rows = []
      for (let index = 0; index < 8; index += 1) {
        rows.push(h('div', { className: 'su-sk', key: String(index) }, ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => h('i', { key: key }))))
      }
      return h(
        'div',
        { className: 'su-skeletons' },
        h('p', { className: 'su-loading' }, props.t ? tr(props.t, 'loadingTitle') : ''),
        rows,
      )
    }

    /** The panel body. */
    function SkillUsagePanel(props) {
      const t = props.t
      const [windowKey, setWindowKey] = React.useState('all')
      const [originFilter, setOriginFilter] = React.useState('all')
      const [onlyUnused, setOnlyUnused] = React.useState(false)
      const [showUninstalled, setShowUninstalled] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [sortKey, setSortKey] = React.useState('total')
      const [sortDir, setSortDir] = React.useState('desc')
      const [reloadToken, setReloadToken] = React.useState(0)
      const [state, setState] = React.useState({ data: null, error: '', busy: true })

      React.useEffect(() => {
        let disposed = false
        let timer = null
        let first = true
        const load = async () => {
          if (!first) setState((previous) => ({ ...previous, busy: true }))
          try {
            const data = await fetchStats(windowKey)
            if (disposed) return
            setState({ data, error: '', busy: false })
          } catch (error) {
            if (disposed) return
            const message = String((error && error.message) || error)
            setState((previous) => ({ data: previous.data, error: message, busy: false }))
          } finally {
            first = false
          }
        }
        void load()
        timer = setInterval(() => void load(), POLL_MS)
        return () => {
          disposed = true
          if (timer !== null) clearInterval(timer)
        }
      }, [windowKey, reloadToken])

      const data = state.data
      const rows = React.useMemo(() => {
        if (!data) return []
        const pool = showUninstalled ? data.skills.concat(data.uninstalled || []) : data.skills
        const needle = query.trim().toLowerCase()
        const filtered = pool.filter((row) => {
          if (onlyUnused && row.total > 0) return false
          if (originFilter !== 'all') {
            const kind = row.origin && row.origin.kind
            if (originFilter === 'self') {
              if (kind !== 'self' && kind !== 'project') return false
            } else if (kind !== originFilter) {
              return false
            }
          }
          if (needle !== '') {
            const haystack = (row.name + ' ' + (row.description || '')).toLowerCase()
            if (haystack.indexOf(needle) === -1) return false
          }
          return true
        })
        const direction = sortDir === 'asc' ? 1 : -1
        filtered.sort((a, b) => {
          if (sortKey === 'name') {
            const left = a.name.toLowerCase()
            const right = b.name.toLowerCase()
            return left < right ? -direction : left > right ? direction : 0
          }
          if (sortKey === 'origin') {
            const left = originText(t, a)
            const right = originText(t, b)
            return left < right ? -direction : left > right ? direction : 0
          }
          return ((Number(a[sortKey]) || 0) - (Number(b[sortKey]) || 0)) * direction
        })
        return filtered
      }, [data, onlyUnused, originFilter, query, showUninstalled, sortKey, sortDir, t])

      const toggleSort = (key) => {
        if (sortKey === key) {
          setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
          return
        }
        setSortKey(key)
        setSortDir(key === 'name' || key === 'origin' ? 'asc' : 'desc')
      }

      const windows = [
        { value: 'all', label: tr(t, 'windowAll') },
        { value: 'today', label: tr(t, 'windowToday') },
        { value: '7d', label: tr(t, 'window7d') },
        { value: '30d', label: tr(t, 'window30d') },
      ]
      const origins = [
        { value: 'all', label: tr(t, 'originAll') },
        { value: 'self', label: tr(t, 'originSelf') },
        { value: 'plugin', label: tr(t, 'originPlugin') },
        { value: 'bundled', label: tr(t, 'originBundled') },
        { value: 'office', label: tr(t, 'originOffice') },
      ]
      const totals = data ? data.totals : null
      const columns = [
        { key: 'name', label: tr(t, 'colSkill') },
        { key: 'origin', label: tr(t, 'colOrigin'), className: 'su-col-origin' },
        { key: 'total', label: tr(t, 'colCalls') },
        { key: 'sessions', label: tr(t, 'colSessions'), end: true },
        { key: 'share', label: tr(t, 'colShare') },
        { key: 'lastUsed', label: tr(t, 'colLast'), end: true, className: 'su-col-last' },
      ]

      return h(
        'div',
        { className: 'su-root' },
        h('style', { key: 'css' }, CSS),
        h(
          'header',
          { className: 'su-head' },
          h('h1', { className: 'su-title' }, tr(t, 'title')),
          h('p', { className: 'su-lede' }, tr(t, 'lede')),
          totals
            ? h(
                'ul',
                { className: 'su-figures' },
                figure(tr(t, 'installed'), totals.installed),
                figure(tr(t, 'used'), totals.used),
                figure(tr(t, 'unused'), totals.unused),
                figure(tr(t, 'calls'), totals.calls),
                figure(tr(t, 'sessionsUsed'), totals.sessions),
              )
            : null,
        ),
        h(
          'div',
          { className: 'su-tools' },
          h(Segmented, { key: 'w', options: windows, value: windowKey, onChange: setWindowKey, label: tr(t, 'windowLabel') }),
          h(Segmented, { key: 'o', options: origins, value: originFilter, onChange: setOriginFilter, label: tr(t, 'originTitle') }),
          h('input', {
            key: 'q',
            className: 'su-search',
            type: 'search',
            value: query,
            placeholder: tr(t, 'search'),
            'aria-label': tr(t, 'search'),
            onChange: (event) => setQuery(event.currentTarget.value),
          }),
          h(
            'span',
            { key: 'c', className: 'su-checks' },
            h(
              'label',
              { key: 'u', className: 'su-check' },
              h('input', { type: 'checkbox', checked: onlyUnused, onChange: (event) => setOnlyUnused(event.currentTarget.checked) }),
              tr(t, 'onlyUnused'),
            ),
            h(
              'label',
              { key: 'x', className: 'su-check' },
              h('input', { type: 'checkbox', checked: showUninstalled, onChange: (event) => setShowUninstalled(event.currentTarget.checked) }),
              tr(t, 'showUninstalled'),
            ),
          ),
          h(
            'span',
            { key: 'g', className: 'su-status' },
            data
              ? h(
                  'span',
                  { key: 'u2', className: 'su-updated' },
                  h('i', { className: 'su-live', 'data-busy': state.busy ? 'true' : 'false', 'aria-hidden': true }),
                  state.busy ? tr(t, 'busy') : tr(t, 'updated', { time: clockOf(data.generatedAt) }),
                )
              : null,
            h('button', { key: 'r', type: 'button', className: 'su-ghost', onClick: () => setReloadToken(reloadToken + 1) }, tr(t, 'refresh')),
          ),
        ),
        state.error && data
          ? h(
              'div',
              { className: 'su-banner', role: 'status' },
              h('span', null, tr(t, 'errorTitle') + ' — ' + state.error),
              h('button', { type: 'button', className: 'su-ghost', onClick: () => setReloadToken(reloadToken + 1) }, tr(t, 'retry')),
            )
          : null,
        !data && state.busy ? h(Skeleton, { key: 'sk', t: t }) : null,
        !data && !state.busy
          ? h(
              'div',
              { className: 'su-state', role: 'alert' },
              h('h3', null, tr(t, 'errorTitle')),
              h('p', null, state.error),
              h('button', { type: 'button', className: 'su-ghost', onClick: () => setReloadToken(reloadToken + 1) }, tr(t, 'retry')),
            )
          : null,
        data
          ? h(
              'div',
              { className: 'su-scroll' },
              h(
                'div',
                { className: 'su-grid su-thead', role: 'row' },
                columns.map((column) =>
                  h(HeadCell, {
                    key: column.key,
                    label: column.label,
                    className: column.className,
                    end: column.end === true,
                    active: sortKey === column.key,
                    direction: sortDir,
                    onSort: () => toggleSort(column.key),
                  }),
                ),
              ),
              rows.length === 0
                ? h(
                    'div',
                    { className: 'su-empty' },
                    h('h3', null, tr(t, emptyKey(data, onlyUnused, query).title)),
                    h('p', null, tr(t, emptyKey(data, onlyUnused, query).hint)),
                  )
                : rows.map((row) => h(Row, { key: (row.name || '') + ':' + ((row.origin && row.origin.kind) || ''), row: row, t: t })),
            )
          : null,
        h(
          'footer',
          { className: 'su-foot' },
          data ? h('span', { key: 's' }, tr(t, 'started', { time: formatStamp(data.startedAt) })) : h('span', { key: 's' }, ''),
          h('span', { key: 'r' }, tr(t, 'footerRule')),
          h('span', { key: 'g', className: 'su-spacer' }),
          h('span', { key: 'a' }, tr(t, 'footerHint2')),
        ),
      )
    }

    /** One figure in the title band. */
    function figure(label, value, className, hint) {
      return h(
        'li',
        { className: 'su-figure' + (className ? ' ' + className : ''), key: label },
        h('b', null, fmt(value), hint ? h('small', null, hint) : null),
        h('span', null, label),
      )
    }

    /** Pick the empty-state copy. */
    function emptyKey(data, onlyUnused, query) {
      if (query.trim() !== '') return { title: 'noMatchTitle', hint: 'noMatchHint' }
      if (onlyUnused && data.totals.used > 0) return { title: 'noMatchTitle', hint: 'noMatchHint' }
      return { title: 'emptyTitle', hint: 'emptyHint' }
    }

    /** Client plugin body: dictionaries, sidebar entry, and panel. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-skill-stats: dictionaries')
      const t = () => ctx.locale.bind(NS)

      const mainSlot = () => ({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ t: t(), locale: ctx.locale }),
      })
      const iconSlot = () => ({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 25,
        locale: NS,
        label: () => t()('title'),
      })

      ctx.effect(
        () => {
          let disposers = []
          const register = () => {
            for (const dispose of disposers.splice(0)) {
              if (typeof dispose === 'function') dispose()
            }
            disposers = [
              ctx.slots.inject('main', () => ctx.slots.register(mainSlot(), SkillUsagePanel)),
              ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(iconSlot(), SkillUsageIcon)),
            ]
          }
          register()
          const off = ctx.locale.subscribe(register)
          return () => {
            if (typeof off === 'function') off()
            for (const dispose of disposers.splice(0)) {
              if (typeof dispose === 'function') dispose()
            }
          }
        },
        'dsh-skill-stats: locale-reactive registrations',
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
