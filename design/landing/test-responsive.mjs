// 全面响应式 + 交互实测：真实设备视口（CDP 模拟），覆盖 1600→320px
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withPage } from './cdp.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const URL_ = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/')
const OUT = path.join(__dirname, '_preview')

const OVERFLOW = `
  var cw = document.documentElement.clientWidth;
  var bad = [];
  document.querySelectorAll('body *').forEach(function(el){
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > cw + 1 || r.left < -1) {
      bad.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '')
        + ' [' + Math.round(r.left) + '→' + Math.round(r.right) + ']');
    }
  });
  return { cw: cw, sw: document.documentElement.scrollWidth, bad: bad.slice(0,10), n: bad.length };
`

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  ' + extra : '')) }
}

const WIDTHS = [1600, 1440, 1280, 1100, 1024, 900, 820, 768, 640, 560, 480, 430, 414, 390, 375, 360, 320]

await withPage(URL_, { width: 1440, height: 900, dsf: 1, mobile: false }, async (api) => {
  console.log('═══ 一、响应式断点溢出检测 ═══')
  for (const w of WIDTHS) {
    await api.resize(w, 900, 1, w <= 820)
    const r = await api.evaluate(OVERFLOW)
    const m900 = await api.evaluate(`return window.matchMedia('(max-width:900px)').matches`)
    const tag = r.n === 0 && r.sw <= r.cw + 1
    ok(tag, `${String(w).padStart(4)}px`, `cw=${r.cw} sw=${r.sw}` + (r.n ? '  溢出: ' + r.bad.join(' | ') : ''))
    void m900
  }

  console.log('\n═══ 二、桌面端交互 ═══')
  await api.resize(1440, 900, 1, false)
  await api.scrollTo(0)

  // 主题切换
  const t0 = await api.evaluate(`return document.documentElement.getAttribute('data-theme')`)
  await api.click('#themeBtn')
  await new Promise(r => setTimeout(r, 250))
  const t1 = await api.evaluate(`return document.documentElement.getAttribute('data-theme')`)
  ok(t0 !== t1, `主题切换 ${t0} → ${t1}`)
  const persisted = await api.evaluate(`try{return localStorage.getItem('moling-theme')}catch(e){return null}`)
  ok(persisted === t1, '主题写入 localStorage', String(persisted))
  await api.click('#themeBtn')
  await new Promise(r => setTimeout(r, 200))

  // 界面预览 Tab
  await api.evaluate(`document.getElementById('showcase').scrollIntoView(); return 1`)
  await new Promise(r => setTimeout(r, 700))
  const tabs = await api.evaluate(`return Array.from(document.querySelectorAll('#tabs .tab')).map(function(t){return t.dataset.p})`)
  ok(tabs.length >= 3, `Tab 数量 = ${tabs.length}`)
  const before = await api.evaluate(`var p=document.querySelector('.panel.on'); return p?p.id:null`)
  await api.click('#tabs .tab:nth-child(3)')
  await new Promise(r => setTimeout(r, 300))
  const after = await api.evaluate(`var p=document.querySelector('.panel.on'); return p?p.id:null`)
  ok(after !== null && after !== before, `Tab 切换 ${before} → ${after}`, '期望 ' + tabs.join(','))
  const onlyOne = await api.evaluate(`return document.querySelectorAll('.panel.on').length`)
  ok(onlyOne === 1, '同时只有一个面板激活', String(onlyOne))
  await api.shot(path.join(OUT, 'r-desktop-tab.png'))

  // FAQ 手风琴
  await api.evaluate(`document.getElementById('faq').scrollIntoView(); return 1`)
  await new Promise(r => setTimeout(r, 700))
  await api.click('#faqList .faq-item:nth-child(1) .faq-q')
  await new Promise(r => setTimeout(r, 400))
  const faqOpen = await api.evaluate(`
    var it=document.querySelector('#faqList .faq-item');
    var a=it.querySelector('.faq-a');
    return { on: it.classList.contains('on'), h: a.getBoundingClientRect().height, max: a.style.maxHeight };
  `)
  ok(faqOpen.on && faqOpen.h > 10, 'FAQ 展开', `h=${Math.round(faqOpen.h)} max=${faqOpen.max}`)
  await api.click('#faqList .faq-item:nth-child(2) .faq-q')
  await new Promise(r => setTimeout(r, 400))
  const faq2 = await api.evaluate(`
    var its=document.querySelectorAll('#faqList .faq-item');
    return { open: Array.from(its).filter(function(x){return x.classList.contains('on')}).length,
             first: its[0].classList.contains('on') };
  `)
  ok(faq2.open === 1 && !faq2.first, 'FAQ 手风琴互斥', `打开数=${faq2.open}`)
  await api.shot(path.join(OUT, 'r-desktop-faq.png'))

  // 导航滚动态
  await api.scrollTo(400)
  await new Promise(r => setTimeout(r, 400))
  const solid = await api.evaluate(`return document.getElementById('nav').classList.contains('solid')`)
  ok(solid, '滚动后导航加 .solid')

  console.log('\n═══ 三、移动端菜单 (390×844) ═══')
  await api.resize(390, 844, 3, true)
  await api.scrollTo(0)
  await new Promise(r => setTimeout(r, 400))

  const pre = await api.evaluate(`
    var l=document.querySelector('.logo').getBoundingClientRect();
    var t=document.querySelector('.nav-toggle').getBoundingClientRect();
    var s=document.querySelector('.logo-sub');
    return { logoSub: s?getComputedStyle(s).display:'none', toggle: getComputedStyle(document.querySelector('.nav-toggle')).display,
             logoRight: Math.round(l.right), toggleRight: Math.round(t.right), cw: document.documentElement.clientWidth };
  `)
  ok(pre.cw === 390, '视口宽度 = 390', String(pre.cw))
  ok(pre.toggle === 'grid', '汉堡按钮可见')
  ok(pre.logoSub === 'none', '移动端隐藏 logo 副标题', pre.logoSub)
  ok(pre.toggleRight <= 390, '按钮未越界', `right=${pre.toggleRight}`)

  await api.click('#menuBtn')
  await new Promise(r => setTimeout(r, 500))
  const opened = await api.evaluate(`
    var p=document.querySelector('.nav-links'); var b=p.getBoundingClientRect();
    var sc=document.querySelector('.nav-scrim');
    return { disp: getComputedStyle(p).display, left: Math.round(b.left), right: Math.round(b.right),
             h: Math.round(b.height), links: p.querySelectorAll('a').length,
             cta: getComputedStyle(document.querySelector('.nav-panel-cta')).display,
             scrim: getComputedStyle(sc).opacity, lock: getComputedStyle(document.documentElement).overflow,
             expanded: document.getElementById('menuBtn').getAttribute('aria-expanded') };
  `)
  ok(opened.disp === 'flex' && opened.h > 100, '菜单面板展开', `h=${opened.h}`)
  ok(opened.left === 0 && opened.right === 390, '面板左右对齐视口', `${opened.left}→${opened.right}`)
  ok(opened.links === 9, '菜单链接数 = 9', String(opened.links))
  ok(opened.cta === 'flex', '面板内 CTA 显示')
  ok(parseFloat(opened.scrim) > 0.9, '遮罩层显示', `opacity=${opened.scrim}`)
  ok(opened.lock === 'hidden', '展开时锁定页面滚动', opened.lock)
  ok(opened.expanded === 'true', 'aria-expanded 同步')
  await api.shot(path.join(OUT, 'r-mobile-menu.png'))

  // 点击导航链接 → 关闭
  await api.click('.nav-links a[href="#features"]')
  await new Promise(r => setTimeout(r, 600))
  const closed1 = await api.evaluate(`return { open: document.getElementById('nav').classList.contains('open'), exp: document.getElementById('menuBtn').getAttribute('aria-expanded') }`)
  ok(!closed1.open && closed1.exp === 'false', '点击菜单项后关闭', JSON.stringify(closed1))

  // 遮罩点击 → 关闭
  await api.click('#menuBtn')
  await new Promise(r => setTimeout(r, 400))
  await api.click('#navScrim')
  await new Promise(r => setTimeout(r, 400))
  const closed2 = await api.evaluate(`return { open: document.getElementById('nav').classList.contains('open'), lock: getComputedStyle(document.documentElement).overflow }`)
  ok(!closed2.open && closed2.lock !== 'hidden', '点击遮罩关闭并解锁滚动', JSON.stringify(closed2))

  // Escape → 关闭
  await api.click('#menuBtn')
  await new Promise(r => setTimeout(r, 400))
  await api.evaluate(`
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    return 1;
  `)
  await new Promise(r => setTimeout(r, 400))
  const closed3 = await api.evaluate(`return document.getElementById('nav').classList.contains('open')`)
  ok(!closed3, 'Esc 关闭菜单')

  // 移动端各区段截图
  await api.shot(path.join(OUT, 'r-mobile-hero.png'))
  for (const y of [1200, 2400, 3600, 4800, 6000, 7200]) {
    await api.scrollTo(y); await new Promise(r => setTimeout(r, 600))
    await api.shot(path.join(OUT, `r-mobile-s${y}.png`))
  }

  console.log('\n═══ 四、360px 最窄屏 ═══')
  await api.resize(360, 780, 3, true)
  await api.scrollTo(0); await new Promise(r => setTimeout(r, 500))
  const r360 = await api.evaluate(OVERFLOW)
  ok(r360.n === 0, '360px 无溢出', `cw=${r360.cw} sw=${r360.sw}` + (r360.n ? ' ' + r360.bad.join('|') : ''))
  await api.shot(path.join(OUT, 'r-360.png'))

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  if (fail) process.exitCode = 1
})
