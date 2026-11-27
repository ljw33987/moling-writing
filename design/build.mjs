// 墨灵写作 · 设计稿构建器：拼接 HTML 并用 Chrome 无头模式截图
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CHROME = 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'

/* ---------------- 图标 sprite（lucide 风格，24×24 线性） ---------------- */
const SPRITE = `<svg style="display:none" xmlns="http://www.w3.org/2000/svg"><defs>
<symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/></symbol>
<symbol id="i-book" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></symbol>
<symbol id="i-pen" viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></symbol>
<symbol id="i-sparkles" viewBox="0 0 24 24"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="m19 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></symbol>
<symbol id="i-layers" viewBox="0 0 24 24"><path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></symbol>
<symbol id="i-user" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></symbol>
<symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></symbol>
<symbol id="i-chev-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
<symbol id="i-chev-right" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></symbol>
<symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></symbol>
<symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.5M12 18.7v2.5M4.7 7.6l2.1 1.2M17.2 15.2l2.1 1.2M4.7 16.4l2.1-1.2M17.2 8.8l2.1-1.2"/></symbol>
<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.2M12 19.8V22M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2 12h2.2M19.8 12H22M4.4 19.6 6 18M18 6l1.6-1.6"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.6 12 5.6 21.5 12 21.5 12 18 18.4 12 18.4 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-panel-left" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M9.5 4v16"/></symbol>
<symbol id="i-panel-right" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M14.5 4v16"/></symbol>
<symbol id="i-download" viewBox="0 0 24 24"><path d="M12 3.5v11.5"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/></symbol>
<symbol id="i-history" viewBox="0 0 24 24"><path d="M3.4 12a8.6 8.6 0 1 0 2.6-6.1"/><path d="M3 4.2v5h5"/><path d="M12 7.6V12l3 1.8"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M7 4.6 19 12 7 19.4z"/></symbol>
<symbol id="i-pause" viewBox="0 0 24 24"><path d="M8.5 5v14M15.5 5v14"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="m4.5 12.5 5 5 10-11"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>
<symbol id="i-zap" viewBox="0 0 24 24"><path d="M13 2.5 4.5 14H11l-1 7.5 8.5-11.5H12z"/></symbol>
<symbol id="i-type" viewBox="0 0 24 24"><path d="M4.5 7V4.8h15V7"/><path d="M12 4.8v14.4"/><path d="M9 19.2h6"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 1 13h10l1-13"/><path d="M9 7V4h6v3"/></symbol>
<symbol id="i-edit" viewBox="0 0 24 24"><path d="M12 20.5h8.5"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></symbol>
<symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.2"/><circle cx="8.6" cy="9.6" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/></symbol>
<symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></symbol>
<symbol id="i-heart" viewBox="0 0 24 24"><path d="M12 20.2s-7.2-4.7-7.2-9.5A3.9 3.9 0 0 1 12 7.9a3.9 3.9 0 0 1 7.2 2.8c0 4.8-7.2 9.5-7.2 9.5z"/></symbol>
<symbol id="i-star" viewBox="0 0 24 24"><path d="m12 3.6 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8z"/></symbol>
<symbol id="i-bookmark" viewBox="0 0 24 24"><path d="M6 3.8h12v17l-6-4.3-6 4.3z"/></symbol>
<symbol id="i-crown" viewBox="0 0 24 24"><path d="M3 7.6 6.6 12 12 5.2 17.4 12 21 7.6V18H3z"/></symbol>
<symbol id="i-wallet" viewBox="0 0 24 24"><path d="M3 8.2a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9.6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M16.2 12.6H19"/></symbol>
<symbol id="i-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.2"/><path d="m3.6 6.6 8.4 6 8.4-6"/></symbol>
<symbol id="i-trend" viewBox="0 0 24 24"><path d="m3 16.5 6-6 4 4 8-8"/><path d="M15 6.5h6v6"/></symbol>
<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
<symbol id="i-file" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></symbol>
<symbol id="i-wand" viewBox="0 0 24 24"><path d="m3 21 9-9"/><path d="m14 4.4 1.2 2.8 2.8 1.2-2.8 1.2L14 12.4l-1.2-2.8L10 8.4l2.8-1.2z"/><path d="m19.2 13.4.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8z"/></symbol>
<symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M4.5 12h15"/><path d="m13 5.5 6.5 6.5-6.5 6.5"/></symbol>
<symbol id="i-arrow-left" viewBox="0 0 24 24"><path d="M19.5 12h-15"/><path d="M11 5.5 4.5 12 11 18.5"/></symbol>
<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11.5a8 8 0 1 0-.7 4.4"/><path d="M20 4.5v6.5h-6.5"/></symbol>
<symbol id="i-message" viewBox="0 0 24 24"><path d="M20.5 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12.5a2 2 0 0 1 2 2z"/></symbol>
<symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.3"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16 5.2a3.3 3.3 0 0 1 0 6.1"/><path d="M17.2 14.4a6.2 6.2 0 0 1 4 5.6"/></symbol>
<symbol id="i-chart" viewBox="0 0 24 24"><path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.4" height="6.4" rx="1"/><rect x="10.3" y="6.6" width="3.4" height="10.8" rx="1"/><rect x="15.6" y="13" width="3.4" height="4.4" rx="1"/></symbol>
<symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15.5" r="4"/><path d="m11 12.6 8-8 2 2-2 2 2 2-3 3-2-2-2 2"/></symbol>
<symbol id="i-logout" viewBox="0 0 24 24"><path d="M15 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3"/><path d="m10 16.5-5-4.5 5-4.5"/><path d="M5 12h11"/></symbol>
<symbol id="i-plus-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></symbol>
<symbol id="i-card" viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="M2.5 10h19"/></symbol>
<symbol id="i-activity" viewBox="0 0 24 24"><path d="M3 12.5h4l2.6 7 4.2-15 2.6 8H21"/></symbol>
<symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 7.5h8M17 7.5h3M4 16.5h3M12 16.5h8"/><circle cx="14.5" cy="7.5" r="2.1"/><circle cx="9.5" cy="16.5" r="2.1"/></symbol>
<symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.6"/></symbol>
<symbol id="i-palette" viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 1 9-9c0 2-1.6 3-3.5 3H16a2 2 0 0 0-1.4 3.4A1.7 1.7 0 0 1 12 21z"/><circle cx="7.6" cy="11" r="1"/><circle cx="10.4" cy="7.2" r="1"/><circle cx="15.2" cy="8" r="1"/></symbol>
<symbol id="i-link" viewBox="0 0 24 24"><path d="M10 13a4.2 4.2 0 0 0 6 0l2.2-2.2a4.2 4.2 0 0 0-6-6L11 6"/><path d="M14 11a4.2 4.2 0 0 0-6 0L5.8 13.2a4.2 4.2 0 0 0 6 6L13 18"/></symbol>
<symbol id="i-cloud" viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.4 8.5z"/></symbol>
<symbol id="i-book-open" viewBox="0 0 24 24"><path d="M12 6.6S10 4.2 5 4.2v13.6c5 0 7 2.4 7 2.4s2-2.4 7-2.4V4.2c-5 0-7 2.4-7 2.4z"/><path d="M12 6.6v13.6"/></symbol>
<symbol id="i-bulb" viewBox="0 0 24 24"><path d="M9.2 18.5h5.6"/><path d="M10.4 21.5h3.2"/><path d="M12 3a6 6 0 0 1 3.6 10.8c-.5.4-.8 1-.9 1.7l-.1.5H9.4l-.1-.5c-.1-.7-.4-1.3-.9-1.7A6 6 0 0 1 12 3z"/></symbol>
<symbol id="i-list" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.6" cy="6" r="1.1"/><circle cx="3.6" cy="12" r="1.1"/><circle cx="3.6" cy="18" r="1.1"/></symbol>
<symbol id="i-tag" viewBox="0 0 24 24"><path d="M3 11.4V4.5a1 1 0 0 1 1-1h6.9L20 12.6 12.6 20z"/><circle cx="7.5" cy="7.5" r="1.4"/></symbol>
<symbol id="i-drag" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></symbol>
<symbol id="i-send" viewBox="0 0 24 24"><path d="M21 3 10.5 13.5"/><path d="M21 3l-6.6 18-3.9-7.5L3 9.6z"/></symbol>
<symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M5 15H4.2a1.2 1.2 0 0 1-1.2-1.2V4.2A1.2 1.2 0 0 1 4.2 3h9.6A1.2 1.2 0 0 1 15 4.2V5"/></symbol>
<symbol id="i-inbox" viewBox="0 0 24 24"><path d="M3 13h4.2l1.8 3h6l1.8-3H21"/><path d="M5.6 5h12.8l2.6 8v5.2a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 18.2V13z"/></symbol>
<symbol id="i-terminal" viewBox="0 0 24 24"><path d="m4 6.5 6 5.5-6 5.5"/><path d="M12.5 18h7.5"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 3.2 2.6 20.3h18.8z"/><path d="M12 10v4.2M12 17.4v.2"/></symbol>
<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.2"/></symbol>
<symbol id="i-rotate" viewBox="0 0 24 24"><path d="M4.2 9.4a8 8 0 1 1-.4 5.2"/><path d="M3.6 4.2v5.4H9"/></symbol>
<symbol id="i-fire" viewBox="0 0 24 24"><path d="M12 21.5c3.6 0 6.5-2.6 6.5-5.9 0-3.9-4-5.7-4-9.6-2.4 1.2-3.4 3.2-3.4 5.2-1.3-.9-1.7-2.2-1.7-3.4-2.4 1.6-4 4.2-4 7.8 0 3.3 2.9 5.9 6.6 5.9z"/></symbol>
<symbol id="i-scan" viewBox="0 0 24 24"><path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16"/><path d="M3 12h18"/></symbol>
<symbol id="i-box" viewBox="0 0 24 24"><path d="M20.5 7.8 12 3 3.5 7.8v8.4L12 21l8.5-4.8z"/><path d="M3.5 7.8 12 12.4l8.5-4.6M12 12.4V21"/></symbol>
<symbol id="i-route" viewBox="0 0 24 24"><circle cx="6" cy="18.5" r="2.6"/><circle cx="18" cy="5.5" r="2.6"/><path d="M8.6 18.5H14a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h5.4"/></symbol>
<symbol id="i-shield-check" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2.2 2.2L15.5 10"/></symbol>
<symbol id="i-megaphone" viewBox="0 0 24 24"><path d="M3 11v2a2 2 0 0 0 2 2h2l7 4V5L7 9H5a2 2 0 0 0-2 2z"/><path d="M18 8.5a5 5 0 0 1 0 7"/><path d="M7 15v4a1.6 1.6 0 0 0 3.2 0"/></symbol>
<symbol id="i-wifi" viewBox="0 0 24 24"><path d="M2.5 8.8a15 15 0 0 1 19 0"/><path d="M5.8 12.4a10 10 0 0 1 12.4 0"/><path d="M9.2 16a5 5 0 0 1 5.6 0"/><circle cx="12" cy="19.4" r="1"/></symbol>
<symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 20h16"/></symbol>
<symbol id="i-save" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></symbol>
<symbol id="i-at" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></symbol>
<symbol id="i-trash-sm" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 1 13h10l1-13"/><path d="M9 7V4h6v3"/></symbol>
</defs></svg>`

const BASE_CSS = fs.readFileSync(path.join(__dirname, 'base.css'), 'utf8')
const BUSINESS_CSS = fs.readFileSync(path.join(__dirname, 'business.css'), 'utf8')

/* 主题切换：zero（默认，Studio Zero）| business（AXIOM 玄序） */
const THEME = process.env.THEME || 'zero'
const IS_BIZ = THEME === 'business'

/* 构建期调色板映射：把写死在 HTML 里的旧色整体换成商务色系 */
const PALETTE = {
  '#4f46e5': '#1C3D6E', '#6366f1': '#2E6099', '#4d4fec': '#234C80',
  '#7c3aed': '#0E1B2E', '#a855f7': '#1C3D6E', '#312e81': '#132A47',
  '#4c1d95': '#0E1B2E', '#6d28d9': '#1C3D6E', '#1e1b4b': '#0A1626',
  '#c026d3': '#A8823C', '#c4b5fd': '#C9A96A', '#1d4ed8': '#234C80',
  '#111827': '#0C1726', '#1e293b': '#14243A', '#475569': '#3D4B60',
  '#374151': '#334054', '#64748b': '#6E7A8C',
  '#0891b2': '#2F6E8F', '#0e7490': '#215A78', '#0f766e': '#1D5E52',
  '#0ea5e9': '#3C87B5', '#059669': '#1F7A5A',
  '#d97706': '#9A6B18', '#b45309': '#8A5A16', '#f59e0b': '#B8862F',
  '#dc2626': '#A32B2B', '#e11d48': '#A62B3F', '#9f1239': '#7E1F31',
  '#c9ccfb': '#BFD0E4', '#dde0fb': '#DCE6F2', '#bfc3f7': '#B3C8E0',
  '#8e93ef': '#7E9CC4',
  '#eef0ff': '#E9F0F8', '#f7f7ff': '#F4F7FB', '#fdf7ff': '#F1F5FA',
  '#f8f8ff': '#F4F7FB', '#f5f0ff': '#EDF2F8', '#f7f0ff': '#EDF2F8',
  '#e8e9f0': '#DCE2EA', '#f1f3f9': '#EEF1F5', '#fafbfe': '#F7F9FB',
  '#fdf1df': '#F5F0E4', '#fef7ec': '#F8F5EE', '#e7f6f0': '#E6F0EA',
  '#eff9f5': '#EDF4EF', '#e6f6fa': '#E7EFF3', '#eff8fb': '#EDF3F6',
  '#fde9ee': '#F3ECEE', '#fdf0f4': '#F6F0F1',
}
function recolor(html) {
  if (!IS_BIZ) return html
  return html.replace(/#[0-9A-Fa-f]{6}\b/g, (m) => PALETTE[m.toLowerCase()] || m)
}

const ic = (name, cls = '') => `<svg class="ic ${cls}"><use href="#i-${name}"/></svg>`

/* ---------------- 页面骨架组件 ---------------- */
function side(active, { admin = false } = {}) {
  const nav = [
    { id: 'workspace', icon: 'grid', label: '工作台' },
    { id: 'editor', icon: 'pen', label: '写作编辑器' },
    { id: 'toolbox', icon: 'sparkles', label: 'AI 工具箱' },
    { id: 'plaza', icon: 'book-open', label: '作品广场' },
    { id: 'settings', icon: 'layers', label: '设定库' },
    { id: 'user', icon: 'user', label: '用户中心' },
  ]
  if (admin) nav.push({ id: 'admin', icon: 'shield', label: '管理后台' })
  return `
<div class="side">
  <div class="side-brand">
    <div class="brand-mark">墨</div>
    <div>
      <div class="brand-name">墨灵写作</div>
      <div class="brand-sub">AI Novel Studio</div>
    </div>
  </div>
  <div class="side-scroll">
    <div class="side-label">创作</div>
    ${nav.slice(0, 5).map(n => `
    <a class="nav-item ${active === n.id ? 'active' : ''}">${ic(n.icon)}<span>${n.label}</span>${n.id === 'toolbox' ? '<span class="nav-badge">18</span>' : ''}</a>`).join('')}
    <div class="side-label">账户</div>
    ${nav.slice(5).map(n => `
    <a class="nav-item ${active === n.id ? 'active' : ''}">${ic(n.icon)}<span>${n.label}</span>${n.id === 'admin' ? '<span class="nav-badge hot">ADMIN</span>' : ''}</a>`).join('')}
    <div class="side-label">工具</div>
    <a class="nav-item">${ic('inbox')}<span>回收站</span></a>
    <a class="nav-item">${ic('terminal')}<span>平台文档</span></a>
  </div>
  <div class="side-foot">
    <div class="credit-card">
      <div class="credit-row">
        <span class="credit-cap">Token 余额</span>
        <span class="credit-cap">年卡会员</span>
      </div>
      <div class="credit-row" style="margin-top:2px">
        <span class="credit-val mono">128,460</span>
        <span style="font-size:11px;color:var(--brand);font-weight:700">充值</span>
      </div>
    </div>
    <div class="user-chip">
      <div class="avatar">梧</div>
      <div style="flex:1;min-width:0">
        <div class="user-name">梧攸笙歌</div>
        <div class="user-mail">wysg@moli.com</div>
      </div>
      ${ic('chev-down', 'ic-sm')}
    </div>
  </div>
</div>`
}

function topbar(crumbHtml, rightHtml = '') {
  return `
<header class="topbar">
  <div class="crumb">${crumbHtml}</div>
  <div class="topbar-right">
    <div class="search-box">${ic('search')}<span>搜索作品、章节、设定…</span><span class="kbd">⌘K</span></div>
    <button class="icon-btn">${ic('globe')}</button>
    <button class="icon-btn">${ic('sun')}</button>
    <button class="icon-btn">${ic('bell')}<span class="dot-badge">3</span></button>
    <button class="icon-btn">${ic('grid')}</button>
    ${rightHtml}
  </div>
</header>`
}

/* ---------------- 变体：顶部横向导航 ---------------- */
const NAV_ITEMS = [
  { id: 'workspace', icon: 'grid', label: '工作台' },
  { id: 'editor', icon: 'pen', label: '编辑器' },
  { id: 'toolbox', icon: 'sparkles', label: 'AI 工具箱' },
  { id: 'plaza', icon: 'book-open', label: '广场' },
  { id: 'settings', icon: 'layers', label: '设定库' },
  { id: 'user', icon: 'user', label: '用户中心' },
  { id: 'admin', icon: 'shield', label: '后台' },
]

function topnav(active) {
  return `
<header class="topnav">
  <div style="display:flex;align-items:center;gap:9px;flex:none">
    <div class="brand-mark" style="width:30px;height:30px;border-radius:9px;font-size:14px">墨</div>
    <span class="brand-text" style="font-weight:700;font-size:15px;letter-spacing:-.01em">墨灵写作</span>
  </div>
  <nav class="topnav-links">
    ${NAV_ITEMS.map(n => `<a class="${active === n.id ? 'on' : ''}">${ic(n.icon)}<span>${n.label}</span></a>`).join('')}
  </nav>
  <div style="margin-left:auto;display:flex;align-items:center;gap:8px;flex:none">
    <div class="search-box" style="width:200px">${ic('search')}<span>搜索…</span><span class="kbd">⌘K</span></div>
    <button class="icon-btn">${ic('bell')}<span class="dot-badge">3</span></button>
    <span class="badge badge-brand mono">128,460</span>
    <div class="avatar">梧</div>
  </div>
</header>`
}

/* ---------------- 变体：极简条（零常驻导航） ---------------- */
function minibar(editor = false) {
  if (editor) {
    return `
<header class="topbar" style="justify-content:flex-start;gap:11px;position:relative">
  <button class="icon-btn">${ic('arrow-left')}</button>
  <span class="ed-title">剑起长安</span>
  <svg class="ic ic-sm" style="color:var(--ink-4)"><use href="#i-chev-right"/></svg>
  <span class="ed-chapter">第 12 章 · 夜入皇城</span>
  <div style="margin-left:auto;display:flex;align-items:center;gap:9px">
    <button class="btn btn-xs btn-soft"><svg class="ic ic-sm" style="color:var(--violet)"><use href="#i-zap"/></svg>AI 连载</button>
    <button class="icon-btn">${ic('search')}</button>
    <button class="icon-btn">${ic('download')}</button>
    <button class="icon-btn">${ic('history')}</button>
    <button class="btn btn-xs btn-primary">发布</button>
    <div class="avatar" style="width:26px;height:26px;border-radius:8px;font-size:11px">梧</div>
  </div>
</header>`
  }
  return `
<header class="topbar" style="justify-content:center;position:relative">
  <div style="position:absolute;left:24px;display:flex;align-items:center;gap:9px">
    <div class="brand-mark" style="width:28px;height:28px;border-radius:8px;font-size:13px">墨</div>
    <span style="font-weight:700;font-size:14px">墨灵写作</span>
  </div>
  <div class="cmd-pill">${ic('search')}<span>搜索作品、章节、设定，或输入命令…</span><span class="kbd">⌘K</span></div>
  <div style="position:absolute;right:24px;display:flex;align-items:center;gap:8px">
    <span class="badge badge-brand mono">128,460</span>
    <div class="avatar">梧</div>
  </div>
</header>`
}

/* ---------------- 变体：底部悬浮 Dock ---------------- */
function dock(active, scrim = true) {
  const nav = [
    { id: 'workspace', icon: 'grid', label: '工作台' },
    { id: 'editor', icon: 'pen', label: '写作' },
    { id: 'toolbox', icon: 'sparkles', label: '工具箱' },
    { id: 'plaza', icon: 'book-open', label: '广场' },
    { id: 'settings', icon: 'layers', label: '设定库' },
    { id: 'user', icon: 'user', label: '我的' },
  ]
  const scrimHtml = scrim
    ? `<div style="position:fixed;left:0;right:0;bottom:0;height:150px;background:linear-gradient(to top, rgba(255,255,255,.95) 8%, rgba(255,255,255,0) 100%);pointer-events:none;z-index:55"></div>`
    : ''
  return `
${scrimHtml}
<nav class="dock">
  ${nav.map(n => `<a class="${active === n.id ? 'on' : ''}">${ic(n.icon)}<span>${n.label}</span></a>`).join('')}
  <span class="d"></span>
  <a>${ic('search')}<span>搜索</span></a>
  <div class="avatar">梧</div>
</nav>`
}

/* ---------------- 移动端：状态栏 + 底部 Tab ---------------- */
function mstatus(dark = false) {
  return `
<div class="m-status">
  <span>9:41</span>
  <span class="sig">
    <svg class="ic ic-sm" style="width:15px;height:15px"><use href="#i-activity"/></svg>
    <svg class="ic ic-sm" style="width:15px;height:15px"><use href="#i-wifi"/></svg>
    <span class="bat"><i></i></span>
  </span>
</div>`
}

function mtabbar(active) {
  const nav = [
    { id: 'workspace', icon: 'grid', label: '工作台' },
    { id: 'toolbox', icon: 'sparkles', label: '工具箱' },
    { id: 'plaza', icon: 'book-open', label: '广场' },
    { id: 'settings', icon: 'layers', label: '设定库' },
    { id: 'user', icon: 'user', label: '我的' },
  ]
  return `
<nav class="m-tabbar">
  ${nav.map(n => `
  <button class="m-tab ${active === n.id ? 'on' : ''}">
    ${ic(n.icon)}
    <span>${n.label}</span>
    ${n.id === 'workspace' ? '<span class="badge">3</span>' : ''}
  </button>`).join('')}
</nav>`
}

/* ---------------- 构建 ---------------- */
const screens = process.argv.slice(2)
const files = screens.length ? screens : fs.readdirSync(path.join(__dirname, 'screens')).filter(f => f.endsWith('.body.html')).sort()

fs.mkdirSync(path.join(__dirname, 'out', '_html'), { recursive: true })

for (const f of files) {
  let body = fs.readFileSync(path.join(__dirname, 'screens', f), 'utf8')
  body = body.replace(/<!--SIDE:([\w-]+)(?::admin)?-->/g, (_, a) => side(a, { admin: a.endsWith('-admin') }))
  body = body.replace(/<!--TOPBAR:([\s\S]*?)-->/g, (_, c) => topbar(c))
  body = body.replace(/<!--TOPNAV:([\w-]+)-->/g, (_, a) => topnav(a))
  body = body.replace(/<!--MINIBAR-->/g, () => minibar(false))
  body = body.replace(/<!--MINIBAR:editor-->/g, () => minibar(true))
  body = body.replace(/<!--DOCK:([\w-]+)-->/g, (_, a) => dock(a, a !== 'editor'))
  body = body.replace(/<!--MSTATUS-->/g, () => mstatus(false))
  body = body.replace(/<!--MTAB:([\w-]+)-->/g, (_, a) => mtabbar(a))

  const isMobile = /^m-/.test(f)
  const scale = process.env.SCALE ? Number(process.env.SCALE) : (isMobile ? 3 : 2)
  const css = IS_BIZ ? `${BASE_CSS}\n${BUSINESS_CSS}` : BASE_CSS
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body style="${isMobile ? 'width:390px;height:844px;overflow:hidden' : ''}">${SPRITE}${recolor(body)}</body></html>`
  const outDir = path.join(
    process.env.OUTDIR ? path.resolve(__dirname, process.env.OUTDIR) : path.join(__dirname, 'out'),
    IS_BIZ ? 'business' : '', isMobile ? 'mobile' : '')
  fs.mkdirSync(path.join(outDir, '_html'), { recursive: true })
  const tmp = path.join(outDir, '_html', f.replace(/\.body\.html$/, '.html'))
  fs.writeFileSync(tmp, html, 'utf8')
  const png = path.join(outDir, f.replace(/\.body\.html$/, '.png'))
  if (fs.existsSync(png)) fs.unlinkSync(png)
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-lcd-text', '--font-render-hinting=none',
    `--screenshot=${png}`,
    isMobile ? '--window-size=390,844' : '--window-size=1600,1000',
    `--force-device-scale-factor=${scale}`,
    'file:///' + tmp.replace(/\\/g, '/'),
  ], { stdio: 'ignore' })
  console.log('✓', path.basename(png), fs.statSync(png).size + 'B')
}
