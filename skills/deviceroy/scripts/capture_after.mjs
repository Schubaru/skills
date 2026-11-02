#!/usr/bin/env node
// Step 6 (web). Before/after frames for the Prototype tab of each platform page.
// For every screen and platform: one page load gives a BEFORE shot, then the fixes the report
// lists for that screen are patched into the live DOM (in the browser only, nothing is written
// to the project) and an AFTER shot is taken. Evidence level of an AFTER frame: none. It is a
// mock-up of the recommendation, and the page says so.
// usage: node capture_after.mjs <runDir>
// Reads  proto/plan.json (written by render_report.plan: the problems listed per screen).
// Writes proto/{slug}__{platform}__{before|after}.webp and proto/shots.json
// (per platform, per screen, per rule: whether its patch applied, and the frames it touched).
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const runDir = path.resolve(process.argv[2])
const cfg = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'))
const inv = JSON.parse(fs.readFileSync(path.join(runDir, 'inventory.json'), 'utf8'))
const out = path.join(runDir, 'proto')
const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'))
const require = createRequire(path.join(cfg._project, 'package.json'))
let chromium
try { ({ chromium } = require('playwright')) } catch { console.log('capture_after: skipped (Playwright is not resolvable from the project)'); process.exit(0) }

const web = cfg.web || {}
const skin = (cfg.prototype || {}).skin || {}
const DEVICES = {
  ios: { viewport: { width: 393, height: 852 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  android: { viewport: { width: 412, height: 915 }, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' },
}
// Rules with a patch below. A listed rule outside this set is reported as "no picture yet".
const PATCHED = {
  android: ['AND-NAV-01', 'AND-NAV-02', 'AND-NAV-04', 'AND-SRC-01', 'AND-MNU-03', 'AND-MNU-05', 'AND-SHT-01', 'AND-CTL-01', 'AND-TGT-01', 'AND-ICN-01', 'X-PAR-01', 'X-PAR-02', 'X-PAR-04'],
  ios: ['IOS-NAV-01', 'IOS-NAV-05', 'IOS-SHT-01', 'IOS-TGT-01', 'X-PAR-01', 'X-PAR-02'],
}
const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'
const hide = (web.hideSelectors || []).join(',')
const SYMBOLS = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&display=block'
const appearance = (cfg.appearance || ['light'])[0]

function urlFor(route) {
  const tpl = cfg.sources.prototypeUrl
  if (tpl.includes('{route}')) return tpl.replace('{route}', route.replace(/^\//, tpl.includes('/{route}') ? '' : '/'))
  return tpl.replace(/\/$/, '') + route
}

/* ------------------------------------------------------------------ in-page patch
   Generic on purpose: targets are found from the audit's own element frames (`box`) or from
   roles and geometry, never from one app's class names. Colours and type are read from the
   app (its "skin"); the structure is the platform's. */
function patch(a) {
  const { platform, skin: over, hideSel } = a
  const AND = platform === 'android', MIN = AND ? 48 : 44
  const vw = innerWidth, vh = innerHeight
  const want = Object.fromEntries(a.rules.map(r => [r.rule, r]))
  const has = (r) => r in want
  const R = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(n => Math.round(n * 10) / 10) }
  const seen = (el) => {
    if (!el || !el.isConnected) return false
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0 && r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
  }
  // on top = not under a scrim or a sheet
  const onTop = (el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)))
    return Boolean(hit && (el.contains(hit) || hit.contains(el)))
  }
  const undo = []
  const css = (el, s) => { undo.push([el, el.style.cssText]); el.style.cssText += ';' + s }
  const rollback = (to) => { while (undo.length > to) { const [el, t] = undo.pop(); el.style.cssText = t } }
  const ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'switch', 'checkbox', 'radio', 'option', 'combobox', 'searchbox', 'slider'])
  const interactive = (el) => {
    const tag = el.tagName.toLowerCase(), role = el.getAttribute('role') || ''
    return (tag === 'a' && el.hasAttribute('href')) || tag === 'button' || tag === 'select' || tag === 'textarea' || (tag === 'input' && el.type !== 'hidden') || ROLES.has(role) || (el.hasAttribute('tabindex') && el.tabIndex >= 0 && tag !== 'div')
  }
  const controls = (root) => [...root.querySelectorAll('a[href],button,[role=tab],[role=link],[role=button]')].filter(seen)
  const labelOf = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim()
  const iconOnly = (el) => Boolean(el.querySelector('svg,img')) && !el.innerText.replace(/[\d\s]/g, '')
  const alpha = (c) => { const m = (c || '').match(/rgba?\(([^)]+)\)/); return m ? (m[1].split(/[,/]/)[3] === undefined ? 1 : parseFloat(m[1].split(/[,/]/)[3])) : 0 }
  const rgb = (c) => { const m = (c || '').match(/rgba?\(([^)]+)\)/); return m ? m[1].split(/[,/ ]+/).slice(0, 3).map(Number) : null }
  const lum = (c) => { const v = rgb(c); return v ? (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255 : 1 }
  const solid = (c) => { const v = rgb(c); return v ? `rgb(${v.join(',')})` : null }
  const pinned = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) if (['fixed', 'sticky', 'absolute'].includes(getComputedStyle(n).position)) return true; return false }
  // the element the audit measured: same frame, the control itself when several share it
  const byBox = (b) => {
    if (!b) return null
    let last = null
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (Math.abs(r.left - b[0]) < 1.5 && Math.abs(r.top - b[1]) < 1.5 && Math.abs(r.width - b[2]) < 1.5 && Math.abs(r.height - b[3]) < 1.5) { if (interactive(el)) return el; last = el }
    }
    return last
  }

  /* ---- find every target and measure it BEFORE anything moves */
  const T = {}, B = {}
  const navish = (n) => n && seen(n) && controls(n).length >= 2 && onTop(n)
  const hint = byBox((want['AND-NAV-01'] || want['IOS-NAV-01'] || {}).box)
  T.dock = navish(hint) ? hint : [...document.querySelectorAll('nav,[role=navigation],[role=tablist]')]
    .filter(n => { const r = n.getBoundingClientRect(); return navish(n) && pinned(n) && r.bottom >= vh * 0.8 && r.top > vh * 0.5 })
    .sort((x, y) => y.getBoundingClientRect().bottom - x.getBoundingClientRect().bottom)[0] || null
  T.sheet = [...document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open]')].find(d => { const r = d.getBoundingClientRect(); return seen(d) && r.height > vh * 0.4 && r.bottom >= vh - 2 }) || null

  // the top bar: the row that holds every control near the top of the screen
  const tops = [...document.querySelectorAll('body *')].filter(el => {
    if (!interactive(el) || !seen(el) || (T.dock && T.dock.contains(el)) || (hideSel && el.closest(hideSel))) return false
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.top + r.height / 2 < 84 && r.height <= 64 && onTop(el)
  })
  if (tops.length) {
    let n = tops[0].parentElement
    while (n && !tops.every(t => n.contains(t))) n = n.parentElement
    while (n && n !== document.body && n.getBoundingClientRect().width < vw * 0.6) n = n.parentElement
    const r = n && n !== document.body ? n.getBoundingClientRect() : null
    if (r && r.height <= 80 && r.top < 48) T.bar = n
  }
  if (T.bar) {
    const inBar = tops.filter(t => T.bar.contains(t) && !tops.some(o => o !== t && o.contains(t)))
    const backHint = byBox((want['AND-NAV-04'] || want['IOS-NAV-05'] || {}).box)
    T.back = (backHint && T.bar.contains(backHint) && backHint) || inBar.find(t => {
      const r = t.getBoundingClientRect(), svg = t.querySelector('svg')
      return r.left + r.width / 2 < vw * 0.3 && (/\b(back|previous|return)\b/i.test(labelOf(t)) || (svg && /arrow-left|chevron-left|arrow_back|caret-left/i.test(svg.getAttribute('class') || '')))
    }) || null
    T.lead = inBar.filter(t => t !== T.back && t.getBoundingClientRect().left + t.getBoundingClientRect().width / 2 < vw * 0.5)
    T.trail = inBar.filter(t => t !== T.back && !T.lead.includes(t))
    if (T.back) B.back = R(T.back)
    if (T.trail.length) { const l = Math.min(...T.trail.map(t => R(t)[0])), tp = Math.min(...T.trail.map(t => R(t)[1])); B.trail = [l, tp, Math.max(...T.trail.map(t => R(t)[0] + R(t)[2])) - l, Math.max(...T.trail.map(t => R(t)[1] + R(t)[3])) - tp] }
  }
  if (has('AND-SRC-01')) {
    const at = byBox(want['AND-SRC-01'].box) || [...document.querySelectorAll('input[type=search],[role=search] input,[role=searchbox]')].find(i => seen(i) && onTop(i))
    const boxed = (el) => { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return r.height >= 36 && r.height <= 64 && r.width >= vw * 0.4 && (alpha(cs.backgroundColor) > 0.5 || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none') }
    if (at && !(T.bar && T.bar.contains(at))) {
      for (let n = at; n && n !== document.body && !T.pill; n = n.parentElement) if (boxed(n)) T.pill = n
      if (!T.pill) T.pill = [...at.querySelectorAll('*')].find(boxed) || null
    }
  }
  T.more = [...document.querySelectorAll('button,a,[role=button]')].find(b => {
    if (!seen(b) || !onTop(b) || !iconOnly(b)) return false
    const svg = b.querySelector('svg'), cs = svg ? [...svg.querySelectorAll('circle')] : []
    return svg && (/ellipsis(?!-vertical)|more-horizontal|dots-horizontal|more_horiz/i.test(svg.getAttribute('class') || '') ||
      (cs.length === 3 && new Set(cs.map(c => c.getAttribute('cy'))).size === 1 && new Set(cs.map(c => c.getAttribute('cx'))).size === 3))
  }) || null
  T.row = has('AND-MNU-05') ? byBox(want['AND-MNU-05'].box) : null
  if (T.row && (!seen(T.row) || !onTop(T.row))) T.row = null
  T.sw = [...document.querySelectorAll('[role=switch]')].find(s => seen(s) && onTop(s)) || null
  if (T.sheet) {
    T.grab = [...T.sheet.querySelectorAll('*')].find(e => { const r = e.getBoundingClientRect(), s = T.sheet.getBoundingClientRect(); return r.height >= 2 && r.height <= 8 && r.width >= 20 && r.width <= 80 && r.top - s.top < 28 && Math.abs(r.left + r.width / 2 - (s.left + s.width / 2)) < 12 }) || null
    B.sheet = [R(T.sheet)[0], R(T.sheet)[1], R(T.sheet)[2], 44]
  }
  for (const k of ['dock', 'pill', 'more', 'row', 'sw']) if (T[k]) B[k] = R(T[k])

  /* ---- the app's skin: its own type and colours, read off what is on screen */
  const items = T.dock ? controls(T.dock).filter(c => !controls(T.dock).some(o => o !== c && o.contains(c))) : []
  const isOn = (c) => c.getAttribute('aria-current') === 'page' || c.getAttribute('aria-selected') === 'true' || /(^|[\s_-])(active|selected|current)($|[\s_-])/i.test(c.getAttribute('class') || '')
  const onItem = items.find(isOn), offItem = items.find(c => !isOn(c))
  const filled = [...document.querySelectorAll('button,a[href],[role=button]')].filter(b => { const cs = getComputedStyle(b), r = b.getBoundingClientRect(); return seen(b) && !(T.dock && T.dock.contains(b)) && alpha(cs.backgroundColor) > 0.9 && lum(cs.backgroundColor) < 0.35 && lum(cs.color) > 0.7 && r.width > 60 })
    .sort((x, y) => y.getBoundingClientRect().width * y.getBoundingClientRect().height - x.getBoundingClientRect().width * x.getBoundingClientRect().height)[0]
  const bodyCs = getComputedStyle(document.body)
  const dockBg = T.dock && [T.dock, T.dock.parentElement].map(e => getComputedStyle(e).backgroundColor).find(c => alpha(c) > 0.3)
  const skin = {
    font: getComputedStyle(offItem || onItem || document.body).fontFamily,
    surface: solid(dockBg) || '#ffffff',
    ink: (onItem && alpha(getComputedStyle(onItem).backgroundColor) > 0.5 && lum(getComputedStyle(onItem).backgroundColor) < 0.4 && solid(getComputedStyle(onItem).backgroundColor)) || solid(bodyCs.color) || '#1c1c1e',
    muted: (offItem && solid(getComputedStyle(offItem).color)) || '#5f5f66',
    primary: filled ? solid(getComputedStyle(filled).backgroundColor) : null,
    onPrimary: filled ? solid(getComputedStyle(filled).color) : '#ffffff',
    ...over,
  }
  if (!skin.primary) skin.primary = skin.ink
  if (!skin.indicator) skin.indicator = `color-mix(in srgb, ${skin.ink} 12%, ${skin.surface})`

  const sym = (name, size = 24, fill = 0) => {
    const s = document.createElement('span')
    s.className = 'dv-sym'; s.textContent = name; s.setAttribute('aria-hidden', 'true')
    s.style.fontSize = size + 'px'; s.style.fontVariationSettings = `'FILL' ${fill}, 'wght' 400, 'GRAD' 0, 'opsz' 24`
    return s
  }
  const SVGNS = 'http://www.w3.org/2000/svg'
  const chevron = () => { const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '22'); s.setAttribute('height', '22'); s.innerHTML = '<path d="M14.5 5 8 12l6.5 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'; return s }
  const setIcon = (host, node) => { const old = host.querySelector('svg,img'); if (old) old.replaceWith(node); else host.prepend(node) }
  const ownIcon = (src, size) => { const g = src.querySelector('svg,img'); if (!g) return null; const c = g.cloneNode(true); c.style.cssText += `;width:${size}px;height:${size}px;flex:none`; return c }
  // Material Symbols by what a control is for; a control with no match keeps its own icon
  const MD = [[/\bcart\b|basket/i, 'shopping_cart'], [/home|house/i, 'home'], [/search|find/i, 'search'], [/care|doctor|health|medical|clinic/i, 'stethoscope'], [/shop|store|\bbag\b/i, 'shopping_bag'],
    [/treat|medic|pill|\brx\b|prescri/i, 'pill'], [/message|chat|inbox/i, 'chat_bubble'], [/mail/i, 'mail'], [/notif|alert|bell/i, 'notifications'], [/profile|account|\bme\b|\byou\b/i, 'person'],
    [/setting|preference/i, 'settings'], [/favou?rite|saved|like|heart/i, 'favorite'], [/calendar|schedule|appointment|visit/i, 'calendar_month'], [/order|receipt|history|activity/i, 'receipt_long'],
    [/wallet|pay|card/i, 'account_balance_wallet'], [/library|book|learn/i, 'menu_book'], [/\bmap\b|near|location/i, 'map'], [/explore|discover|browse|feed/i, 'explore'], [/dashboard|overview/i, 'dashboard'],
    [/report|stat|analytic|chart/i, 'bar_chart'], [/help|support/i, 'help'], [/camera|scan/i, 'photo_camera'], [/workout|fitness|exercise/i, 'fitness_center'], [/list|task|todo/i, 'checklist'],
    [/document|file|note/i, 'description'], [/people|team|community|friend/i, 'group'], [/share/i, 'share'], [/filter/i, 'tune'], [/close|dismiss/i, 'close'], [/edit|compose|write/i, 'edit'], [/add|new|create/i, 'add'], [/more|menu|option/i, 'more_vert']]
  const mdName = (label) => (MD.find(([re]) => re.test(label)) || [])[1]

  const style = document.createElement('style')
  style.textContent = `
  .dv-sym{font-family:'Material Symbols Rounded';font-weight:400;font-style:normal;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;font-feature-settings:'liga';-webkit-font-smoothing:antialiased;user-select:none}
  .dv-nav{position:fixed;left:0;right:0;bottom:0;height:64px;z-index:2147483000;display:flex;background:${skin.surface};box-shadow:0 -1px 0 color-mix(in srgb, ${skin.ink} 9%, transparent);font-family:${skin.font}}
  .dv-nav a{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:${skin.muted};font-size:12px;line-height:16px;font-weight:600;letter-spacing:.01em;text-decoration:none}
  .dv-nav a .dv-ind{position:relative;display:grid;place-items:center;width:56px;height:32px;border-radius:999px}
  .dv-nav a[aria-current=page]{color:${skin.ink};font-weight:700}
  .dv-nav a[aria-current=page] .dv-ind{background:${skin.indicator}}
  .dv-nav .dv-badge{position:absolute;top:4px;right:14px;width:8px;height:8px;border-radius:50%;background:#d92d20;box-shadow:0 0 0 2px ${skin.surface}}
  .dv-fab{position:fixed;right:16px;bottom:80px;z-index:2147483001;height:56px;min-width:56px;box-sizing:border-box;padding:0 20px 0 16px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;gap:12px;background:${skin.primary};color:${skin.onPrimary};font:700 14px/20px ${skin.font};letter-spacing:.01em;text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.3),0 4px 8px 3px rgba(0,0,0,.15)}
  .dv-tabs{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483000;box-sizing:border-box;height:62px;padding:4px;display:flex;gap:2px;border-radius:31px;background:color-mix(in srgb, ${skin.surface} 68%, transparent);-webkit-backdrop-filter:blur(22px) saturate(180%);backdrop-filter:blur(22px) saturate(180%);box-shadow:inset 0 0 0 .5px rgba(255,255,255,.7),0 0 0 .5px rgba(0,0,0,.06),0 10px 30px rgba(0,0,0,.14);font-family:${skin.font}}
  .dv-tabs a{min-width:64px;padding:0 10px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:27px;color:${skin.muted};font-size:10px;line-height:12px;font-weight:600;text-decoration:none;white-space:nowrap}
  .dv-tabs a[aria-current=page]{color:${skin.primary};background:color-mix(in srgb, ${skin.ink} 8%, transparent)}
  .dv-tabs .dv-ico{position:relative;display:grid;place-items:center;height:26px}
  .dv-tabs .dv-badge{position:absolute;top:0;right:-6px;width:8px;height:8px;border-radius:50%;background:#ff3b30}
  `
  document.head.append(style)

  const before = {}, afterFns = {}
  const mark = (rule, b, fn) => { before[rule] = b; afterFns[rule] = fn }

  /* ---- small tap targets, measured before anything moves (the audit's own test) */
  const small = []
  for (const el of document.querySelectorAll('body *')) {
    if ((hideSel && el.closest(hideSel)) || !interactive(el) || !seen(el)) continue
    const cs = getComputedStyle(el)
    if (cs.pointerEvents === 'none') continue
    if (cs.display === 'inline' && el.parentElement && /\S/.test([...el.parentElement.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(''))) continue
    let nested = false
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (interactive(p)) { nested = true; break }
    if (nested) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || (r.width >= MIN && r.height >= MIN)) continue
    small.push(el)
  }
  small.sort((x, y) => { const p = x.getBoundingClientRect(), q = y.getBoundingClientRect(); return p.top - q.top || p.left - q.left })
  const smallBefore = small.map(R)

  /* ---- the tab bar: Android's navigation bar, or iPhone's floating glass bar */
  let nav = null
  const NAV_RULES = AND ? ['AND-NAV-01', 'AND-NAV-02', 'X-PAR-01', 'X-PAR-02'] : ['IOS-NAV-01', 'X-PAR-01', 'X-PAR-02']
  if (T.dock && items.length >= 2 && NAV_RULES.slice(0, -1).some(has)) {
    nav = document.createElement('nav'); nav.className = AND ? 'dv-nav' : 'dv-tabs'; nav.setAttribute('aria-label', T.dock.getAttribute('aria-label') || 'Main')
    for (const c of items.slice(0, 5)) {
      const raw = labelOf(c), label = raw.replace(/,.*$/, ''), on = isOn(c)
      const item = document.createElement('a'); item.href = c.getAttribute('href') || '#'
      if (on) item.setAttribute('aria-current', 'page')
      const ind = document.createElement('span'); ind.className = AND ? 'dv-ind' : 'dv-ico'
      const md = AND && mdName(label)
      ind.append(md ? sym(md, 24, on ? 1 : 0) : ownIcon(c, 24) || sym('circle', 24))
      if (/unread|new\b/i.test(raw) || [...c.querySelectorAll('span,i,b')].some(d => { const r = d.getBoundingClientRect(); return r.width > 3 && r.width <= 12 && Math.abs(r.width - r.height) < 1 && !d.innerText.trim() && alpha(getComputedStyle(d).backgroundColor) > 0.8 })) { const b = document.createElement('span'); b.className = 'dv-badge'; ind.append(b) }
      item.append(ind); if (label) item.append(document.createTextNode(label)); nav.append(item)
    }
    let host = T.dock
    while (host.parentElement !== document.body && pinned(host.parentElement) && host.parentElement.getBoundingClientRect().top > vh * 0.5 && [...host.parentElement.children].filter(seen).length === 1) host = host.parentElement
    css(host, 'display:none!important')
    document.body.append(nav)
    for (const r of NAV_RULES) if (has(r)) mark(r, [B.dock], () => [R(nav)])
  }

  /* ---- the top bar */
  let barDone = false
  if (T.bar && (T.back || T.trail.length)) {
    const at = undo.length, bar = T.bar, r0 = bar.getBoundingClientRect(), pos = getComputedStyle(bar).position
    const kids = [...bar.querySelectorAll('*')].filter(seen)
    if (AND) {
      // Material's 64dp bar, edge to edge, with 48dp icon buttons 4dp in from each side
      css(bar, `height:64px;box-sizing:border-box;padding-left:4px;padding-right:4px;align-items:center;max-width:none;` +
        (pos === 'fixed' || pos === 'absolute' ? 'top:0;left:0;right:0;width:auto' : `margin-top:${-r0.top}px;margin-left:${-r0.left}px;margin-right:${-(vw - r0.right)}px;width:${vw}px`) +
        (/flex|grid/.test(getComputedStyle(bar).display) ? '' : ';display:flex;justify-content:space-between'))
      if (T.back) { css(T.back, 'width:48px;height:48px;min-width:48px;flex:none;display:grid;place-items:center;background:transparent;box-shadow:none;border:0;border-radius:999px'); if (T.back.parentElement !== bar) css(T.back.parentElement, 'gap:4px;align-items:center') }
      else if (T.lead[0]) css(T.lead[0], 'margin-left:12px')
      for (const t of T.lead) if (R(t)[3] < 48) css(t, 'min-height:48px;display:grid;align-items:center')
      const groups = new Set(T.trail.map(t => t.parentElement).filter(p => p !== bar))
      for (const g of groups) css(g, 'gap:0;align-items:center')
      for (const t of T.trail) {
        const [, , w, h] = R(t)
        if (iconOnly(t)) css(t, 'width:48px;height:48px;min-width:48px;flex:none;display:grid;place-items:center')
        else if (w <= 48 && h < 48) css(t, `margin:${(48 - h) / 2}px ${(48 - w) / 2}px`)
      }
    } else {
      css(bar, 'min-height:44px;align-items:center')
      if (T.back) css(T.back, 'width:44px;height:44px;min-width:44px;flex:none;display:grid;place-items:center;border-radius:50%;background:color-mix(in srgb, #fff 70%, transparent);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);box-shadow:inset 0 0 0 .5px rgba(255,255,255,.8),0 0 0 .5px rgba(0,0,0,.06),0 2px 10px rgba(0,0,0,.08);border:0')
    }
    // a bar that did not take the new shape is put back rather than shown broken
    const r1 = bar.getBoundingClientRect()
    const ok = r1.height <= 84 && kids.every(k => { const r = k.getBoundingClientRect(); return !seen(k) || (r.left >= -1 && r.right <= vw + 1) }) && (!AND || (Math.abs(r1.left) < 2 && Math.abs(r1.width - vw) < 2))
    if (!ok) rollback(at)
    else {
      barDone = true
      if (AND) {
        if (T.back) setIcon(T.back, sym('arrow_back'))
        for (const t of T.trail) if (iconOnly(t)) {
          const md = mdName(labelOf(t)); if (md) setIcon(t, sym(md)); else { const g = t.querySelector('svg,img'); if (g) g.style.cssText += ';width:24px;height:24px' }
          for (const d of t.querySelectorAll('*')) { const cs = getComputedStyle(d); if (cs.position === 'absolute' && d.tagName !== 'svg' && !d.classList.contains('dv-sym')) { const tp = parseFloat(cs.top), rt = parseFloat(cs.right); if (!isNaN(tp) && !isNaN(rt)) css(d, `top:${tp + 8}px;right:${rt + 8}px`) } }
        }
      } else if (T.back) setIcon(T.back, chevron())
      const backRule = AND ? 'AND-NAV-04' : 'IOS-NAV-05'
      if (T.back && has(backRule)) mark(backRule, [B.back], () => [R(T.back)])
      if (AND && B.trail) for (const r of ['X-PAR-04', 'AND-ICN-01']) if (has(r)) mark(r, [B.trail], () => { const l = Math.min(...T.trail.map(t => R(t)[0])), tp = Math.min(...T.trail.map(t => R(t)[1])); return [[l, tp, Math.max(...T.trail.map(t => R(t)[0] + R(t)[2])) - l, Math.max(...T.trail.map(t => R(t)[1] + R(t)[3])) - tp]] })
    }
  }

  /* ---- AND-SRC-01: the search field in the page becomes the search bar at the top */
  if (AND && barDone && T.pill && has('AND-SRC-01')) {
    const pill = T.pill
    let hole = pill.parentElement
    T.bar.insertBefore(pill, T.trail.length ? [...T.bar.children].find(c => T.trail.some(t => c === t || c.contains(t))) || null : null)
    css(pill, `flex:1 1 0;min-width:0;width:auto;height:56px;box-sizing:border-box;margin:0 4px 0 ${T.back ? 0 : 12}px;padding-left:16px;box-shadow:0 0 0 1px color-mix(in srgb, ${skin.ink} 10%, transparent),0 1px 2px rgba(0,0,0,.06)`)
    const go = [...pill.querySelectorAll('button,[role=button]')].filter(seen).pop()
    if (go && iconOnly(go) && R(go)[0] > R(pill)[0] + R(pill)[2] / 2) css(go, 'display:none')
    const lens = pill.querySelector(':scope > svg'); if (lens) lens.replaceWith(sym('search'))
    // whatever held the field and is now empty closes up; the title gives its place to the field
    while (hole && hole !== document.body && !hole.contains(T.bar) && ![...hole.querySelectorAll('*')].some(seen)) { css(hole, 'display:none'); hole = hole.parentElement }
    for (const t of T.lead) css(t, 'display:none')
    for (const c of [...T.bar.children]) {
      const keeps = c === pill || (T.back && (c === T.back || c.contains(T.back))) || T.trail.some(t => c === t || c.contains(t))
      if (!keeps) css(c, 'display:none')
    }
    mark('AND-SRC-01', [B.pill], () => [R(pill)])
  }

  /* ---- AND-MNU-03: the sideways "…" becomes the upright overflow icon */
  if (AND && T.more && has('AND-MNU-03')) { setIcon(T.more, sym('more_vert', 20)); mark('AND-MNU-03', [B.more], () => [R(T.more)]) }

  /* ---- AND-MNU-05: the create row becomes a floating action button */
  if (AND && T.row && has('AND-MNU-05')) {
    const label = (T.row.getAttribute('aria-label') || T.row.innerText.split('\n')[0] || '').trim()
    const fab = document.createElement('a'); fab.className = 'dv-fab'; fab.href = T.row.getAttribute('href') || '#'
    fab.append(sym(/message|compose|write|chat|note|post|reply/i.test(label) ? 'edit' : 'add', 24))
    if (label && label.length <= 22) fab.append(document.createTextNode(label)); else fab.style.padding = '0'
    if (!nav) fab.style.bottom = '16px'
    css(T.row, 'display:none'); document.body.append(fab)
    mark('AND-MNU-05', [B.row], () => [R(fab)])
  }

  /* ---- an open sheet takes the platform's shape */
  const sheetRule = AND ? 'AND-SHT-01' : 'IOS-SHT-01'
  if (T.sheet && has(sheetRule)) {
    css(T.sheet, AND ? 'border-top-left-radius:28px;border-top-right-radius:28px' : 'margin-left:8px;margin-right:8px;width:auto;border-radius:38px 38px 0 0')
    let grab = T.grab
    if (!grab) { grab = document.createElement('span'); T.sheet.prepend(grab); css(grab, 'display:block;flex:none') }
    css(grab, AND ? `width:32px;height:4px;border-radius:999px;background:color-mix(in srgb, ${skin.ink} 40%, transparent);margin:16px auto 6px`
      : `width:36px;height:5px;border-radius:999px;background:color-mix(in srgb, ${skin.ink} 28%, transparent);margin:6px auto 4px`)
    mark(sheetRule, [B.sheet], () => [[R(T.sheet)[0], R(T.sheet)[1], R(T.sheet)[2], 44]])
  }

  /* ---- AND-CTL-01: a switch on screen takes the Material track and thumb */
  if (AND && T.sw && has('AND-CTL-01')) {
    const on = T.sw.getAttribute('aria-checked') === 'true'
    T.sw.replaceChildren()
    css(T.sw, `width:52px;height:32px;min-width:52px;border-radius:999px;position:relative;padding:0;box-sizing:border-box;background:${on ? skin.primary : 'transparent'};border:2px solid ${on ? skin.primary : skin.muted}`)
    const th = document.createElement('span')
    css(th, `position:absolute;top:50%;${on ? `right:2px;width:24px;height:24px;background:${skin.onPrimary};color:${skin.primary}` : `left:6px;width:16px;height:16px;background:${skin.muted}`};border-radius:50%;transform:translateY(-50%);display:grid;place-items:center`)
    if (on) th.append(sym('check', 16))
    T.sw.append(th)
    mark('AND-CTL-01', [B.sw], () => [R(T.sw)])
  }

  /* ---- tap targets: Android's button-like controls grow to 40dp; every tap area reaches the minimum where there is room */
  const tgtRule = AND ? 'AND-TGT-01' : 'IOS-TGT-01'
  if (has(tgtRule) && small.length) {
    if (AND) for (const el of small) {
      if (!el.isConnected || (T.bar && T.bar.contains(el)) || (T.dock && T.dock.contains(el))) continue
      const cs = getComputedStyle(el), r = el.getBoundingClientRect()
      if (el.tagName === 'INPUT' || r.height > 44 || !(alpha(cs.backgroundColor) > 0.05 || parseFloat(cs.borderTopWidth) > 0)) continue
      if (r.height < 40) css(el, 'min-height:40px')
      if (r.width < 40) css(el, 'min-width:40px')
    }
    before[tgtRule] = { pin: smallBefore.slice(0, 1), all: smallBefore }
    afterFns[tgtRule] = () => {
      const els = small.filter(el => seen(el) && !(T.dock && T.dock.contains(el)))
      const o = els.map(el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } })
      if (nav) for (const c of nav.children) { const r = c.getBoundingClientRect(); o.push({ l: r.left, t: r.top, r: r.right, b: r.bottom }) }
      const e = o.map(q => { const gx = Math.max(0, MIN - (q.r - q.l)) / 2, gy = Math.max(0, MIN - (q.b - q.t)) / 2; return { l: q.l - gx, t: q.t - gy, r: q.r + gx, b: q.b + gy } })
      // neighbours share the gap between them instead of overlapping
      for (let i = 0; i < e.length; i++) for (let j = i + 1; j < e.length; j++) {
        const x = e[i], y = e[j]
        if (x.l >= y.r || y.l >= x.r || x.t >= y.b || y.t >= x.b) continue
        const A = o[i], C = o[j]
        if (A.r <= C.l) { const m = (A.r + C.l) / 2; x.r = Math.min(x.r, m); y.l = Math.max(y.l, m) }
        else if (C.r <= A.l) { const m = (C.r + A.l) / 2; y.r = Math.min(y.r, m); x.l = Math.max(x.l, m) }
        else if (A.b <= C.t) { const m = (A.b + C.t) / 2; x.b = Math.min(x.b, m); y.t = Math.max(y.t, m) }
        else if (C.b <= A.t) { const m = (C.b + A.t) / 2; y.b = Math.min(y.b, m); x.t = Math.max(x.t, m) }
      }
      const rr = e.map(q => { const l = Math.max(0, q.l), t = Math.max(0, q.t); return [l, t, Math.min(vw, q.r) - l, Math.min(vh, q.b) - t].map(n => Math.round(n * 10) / 10) })
      const fi = els.indexOf(small.find(el => seen(el)))
      return { pin: fi >= 0 ? [rr[fi]] : rr.slice(0, 1), all: rr, tight: rr.filter(q => q[2] < MIN - 0.5 || q[3] < MIN - 0.5).length }
    }
  }

  window.__dvAfter = () => { const o = {}; for (const [k, fn] of Object.entries(afterFns)) o[k] = fn(); return o }
  return before
}

// PNG -> WebP, plus the edge colours the device frame continues into its system bars.
async function encode(helper, png) {
  return helper.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const px = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return '#' + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, '0')).join('') }
    return { webp: c.toDataURL('image/webp', 0.9).split(',')[1], top: px(6, 2), bottom: px(6, c.height - 3) }
  }, png.toString('base64'))
}

const prevPath = path.join(out, 'shots.json')
const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : {}
const shots = { patched: PATCHED, scale: 2 }
const todo = []
for (const platform of ['ios', 'android']) {
  shots[platform] = {}
  for (const s of plan[platform] || []) {
    const page = inv.find(i => i.slug === s.slug)
    if (!page) continue
    // unchanged plan + frames already on disk = nothing to redo (a re-render after judgments stays quick)
    const key = createHash('sha1').update(JSON.stringify([page.url, s.rules, skin, hide, PATCHED[platform]])).digest('hex').slice(0, 12)
    const old = (prev[platform] || {})[s.slug]
    const files = ['before', 'after'].map(side => path.join(out, `${s.slug}__${platform}__${side}.webp`))
    if (old && old.ok && old.key === key && files.every(f => fs.existsSync(f))) shots[platform][s.slug] = old
    else todo.push({ platform, s, page, key, files })
  }
}

let done = 0
if (todo.length) {
  const browser = await chromium.launch()
  const helper = await (await browser.newContext()).newPage()
  for (const platform of ['ios', 'android']) {
    const mine = todo.filter(t => t.platform === platform)
    if (!mine.length) continue
    const ctx = await browser.newContext({
      ...DEVICES[platform], deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce', colorScheme: appearance,
      locale: 'en-US', timezoneId: web.timezone || 'America/New_York', extraHTTPHeaders: web.headers || {},
      storageState: web.storageState ? path.resolve(cfg._project, web.storageState) : undefined,
    })
    for (const { s, page: info, key, files } of mine) {
      const page = await ctx.newPage()
      const entry = { key, rules: {} }
      try {
        if (web.freezeTime) await page.clock.setFixedTime(new Date(web.freezeTime))
        await page.goto(urlFor(info.url), { waitUntil: 'load', timeout: 30000 })
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
        await page.addStyleTag({ content: FREEZE_CSS + (hide ? `${hide}{display:none!important}` : '') })
        if (platform === 'android') {
          // the icon font is only needed while the AFTER frame is drawn; offline, controls keep their own icons' space
          await page.addStyleTag({ url: SYMBOLS }).catch(() => {})
          await page.evaluate(() => document.fonts.load('24px "Material Symbols Rounded"', 'home').catch(() => {}))
        }
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(web.settleMs ?? 600)
        const shotBefore = await page.screenshot({ animations: 'disabled', caret: 'hide' })
        const before = await page.evaluate(patch, { platform, rules: s.rules, skin, hideSel: hide })
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(250)
        const after = await page.evaluate(() => window.__dvAfter())
        const shotAfter = await page.screenshot({ animations: 'disabled', caret: 'hide' })
        const eb = await encode(helper, shotBefore), ea = await encode(helper, shotAfter)
        fs.writeFileSync(files[0], Buffer.from(eb.webp, 'base64'))
        fs.writeFileSync(files[1], Buffer.from(ea.webp, 'base64'))
        entry.edge = { before: [eb.top, eb.bottom], after: [ea.top, ea.bottom] }
        for (const { rule } of s.rules) {
          const b = before[rule], a = after[rule]
          if (!b || !a || (b.pin && !(b.pin.length && a.pin.length))) { entry.rules[rule] = { applied: false }; continue }
          entry.rules[rule] = b.pin
            ? { applied: true, before: b.pin[0], after: a.pin[0], beforeAll: b.all, afterAll: a.all, tight: a.tight }
            : { applied: true, before: b[0], after: a[0] }
        }
        entry.ok = true; done++
      } catch (e) {
        entry.ok = false; entry.error = String(e.message || e).split('\n')[0]
      }
      shots[platform][s.slug] = entry
      await page.close()
    }
    await ctx.close()
  }
  await browser.close()
}
fs.writeFileSync(prevPath, JSON.stringify(shots, null, 1) + '\n')
const all = ['ios', 'android'].flatMap(p => Object.entries(shots[p]).map(([slug, e]) => ({ p, slug, e })))
const bad = all.filter(x => !x.e.ok)
console.log(`capture_after: ${all.length - bad.length}/${all.length} before/after pairs (${done} captured, ${all.length - bad.length - done} reused)` +
  (bad.length ? ` — failed: ${bad.slice(0, 6).map(b => `${b.slug}/${b.p}`).join(', ')}${bad.length > 6 ? ' …' : ''}` : ''))
