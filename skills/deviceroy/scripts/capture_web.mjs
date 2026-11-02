#!/usr/bin/env node
// Step 2 (web). Capture each screen at a fixed iPhone-class and Pixel-class viewport.
// usage: node capture_web.mjs <runDir>
// Writes screenshots/{slug}__{platform}__{appearance}.png and raw/{slug}__{platform}__{appearance}.json
// (raw DOM element frames; hierarchy.py normalizes them). Evidence level: W.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const runDir = path.resolve(process.argv[2])
const cfg = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'))
const inv = JSON.parse(fs.readFileSync(path.join(runDir, 'inventory.json'), 'utf8'))
const require = createRequire(path.join(cfg._project, 'package.json'))
const { chromium } = require('playwright')

const web = cfg.web || {}
const DEVICES = {
  ios: { viewport: { width: 393, height: 852 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  android: { viewport: { width: 412, height: 915 }, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' },
}
const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'
const hide = (web.hideSelectors || []).join(',')
fs.mkdirSync(path.join(runDir, 'screenshots'), { recursive: true })
fs.mkdirSync(path.join(runDir, 'raw'), { recursive: true })

function urlFor(route) {
  const tpl = cfg.sources.prototypeUrl
  if (tpl.includes('{route}')) return tpl.replace('{route}', route.replace(/^\//, tpl.includes('/{route}') ? '' : '/'))
  return tpl.replace(/\/$/, '') + route
}

// Runs in the page. Keep element order = DOM order; parent = nearest recorded ancestor.
function dump(hideSel) {
  const vw = innerWidth, vh = innerHeight
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'switch', 'checkbox', 'radio', 'option', 'combobox', 'searchbox', 'slider'])
  const KEEP_ROLES = new Set(['navigation', 'tablist', 'menu', 'menubar', 'listbox', 'radiogroup', 'dialog', 'alertdialog', 'toolbar', 'search', 'banner', 'switch', 'status'])
  const out = [], index = new Map()
  const txt = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  for (const el of document.querySelectorAll('body *')) {
    if (hideSel && el.closest(hideSel)) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute('role') || ''
    const interactive = (tag === 'a' && el.hasAttribute('href')) || tag === 'button' || tag === 'select' || tag === 'textarea' ||
      (tag === 'input' && el.type !== 'hidden') || INTERACTIVE_ROLES.has(role) ||
      (el.hasAttribute('tabindex') && el.tabIndex >= 0 && tag !== 'div')
    const backdrop = cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : ''
    const pos = cs.position
    const keep = interactive || backdrop || KEEP_ROLES.has(role) || ['nav', 'header', 'dialog', 'footer'].includes(tag) ||
      ((pos === 'fixed' || pos === 'sticky') && r.width > vw * 0.5)
    if (!keep) continue
    if (interactive && cs.pointerEvents === 'none') continue
    let parent = -1
    for (let a = el.parentElement; a; a = a.parentElement) if (index.has(a)) { parent = index.get(a); break }
    let fixedAncestor = ''
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const p = getComputedStyle(a).position
      if (p === 'fixed' || p === 'sticky') { fixedAncestor = p; break }
    }
    const bg = cs.backgroundColor.match(/rgba?\(([^)]+)\)/)
    const alpha = bg ? (bg[1].split(',')[3] === undefined ? 1 : Number(bg[1].split(',')[3])) : 0
    const inText = interactive && cs.display === 'inline' && el.parentElement && /\S/.test([...el.parentElement.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(''))
    const labelledby = el.getAttribute('aria-labelledby')
    const label = txt(el.getAttribute('aria-label') || (labelledby && document.getElementById(labelledby)?.innerText) || (interactive || role ? el.innerText : '') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder') || '')
    const icon = el.querySelector('svg')
    index.set(el, out.length)
    out.push({
      tag, role, label, testID: el.getAttribute('data-testid') || el.id || '',
      bbox: [r.left, r.top, r.width, r.height], interactive, parent,
      position: pos, fixedAncestor, backdrop, bgAlpha: alpha, fontPx: parseFloat(cs.fontSize),
      inText: Boolean(inText), haspopup: el.getAttribute('aria-haspopup') || '',
      state: { checked: el.getAttribute('aria-checked'), selected: el.getAttribute('aria-selected'), pressed: el.getAttribute('aria-pressed'), current: el.getAttribute('aria-current'), expanded: el.getAttribute('aria-expanded') },
      type: el.getAttribute('type') || '', iconOnly: Boolean(icon) && !txt(el.innerText),
      iconHint: icon ? txt([icon.getAttribute('class'), icon.getAttribute('data-icon'), icon.getAttribute('aria-label')].filter(Boolean).join(' ')) : '',
      cls: txt(typeof el.className === 'string' ? el.className : ''),
    })
  }
  return { viewport: [vw, vh], title: document.title, elements: out }
}

const browser = await chromium.launch()
const results = []
for (const appearance of cfg.appearance || ['light']) {
  for (const platform of ['ios', 'android']) {
    const ctx = await browser.newContext({
      ...DEVICES[platform], deviceScaleFactor: web.deviceScaleFactor || 1, isMobile: true, hasTouch: true,
      reducedMotion: 'reduce', colorScheme: appearance, locale: 'en-US', timezoneId: web.timezone || 'America/New_York',
      extraHTTPHeaders: web.headers || {},
      storageState: web.storageState ? path.resolve(cfg._project, web.storageState) : undefined,
    })
    for (const s of inv) {
      const page = await ctx.newPage()
      if (web.freezeTime) await page.clock.setFixedTime(new Date(web.freezeTime))
      const url = urlFor(s.url)
      const base = `${s.slug}__${platform}__${appearance}`
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 })
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
        await page.addStyleTag({ content: FREEZE_CSS + (hide ? `${hide}{display:none!important}` : '') })
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(web.settleMs ?? 600)
        await page.screenshot({ path: path.join(runDir, 'screenshots', `${base}.png`), animations: 'disabled', caret: 'hide' })
        const d = await page.evaluate(dump, hide)
        fs.writeFileSync(path.join(runDir, 'raw', `${base}.json`), JSON.stringify({ source: 'dom', platform, appearance, url, ...d }))
        results.push({ slug: s.slug, platform, appearance, ok: true })
      } catch (e) {
        results.push({ slug: s.slug, platform, appearance, ok: false, error: String(e.message || e).split('\n')[0] })
      }
      await page.close()
    }
    await ctx.close()
  }
}
await browser.close()
fs.writeFileSync(path.join(runDir, 'capture-web.json'), JSON.stringify(results, null, 2) + '\n')
const bad = results.filter(r => !r.ok)
console.log(`capture_web: ${results.length - bad.length}/${results.length} captures` + (bad.length ? ` — failed: ${bad.map(b => `${b.slug}/${b.platform}`).join(', ')}` : ''))
