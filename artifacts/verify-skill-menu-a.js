// Version A: keyboard path through the realigned overflow menu, checking the
// inset focus stripe survives the surface's new `overflow: hidden`.
const puppeteer = require('puppeteer')

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
  await page.goto('http://localhost:4477/skills.html', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 400))

  await page.focus('[data-sh-skill-menu-trigger]')
  await page.keyboard.press('Enter')
  await new Promise(r => setTimeout(r, 300))
  await page.keyboard.press('ArrowDown')
  await new Promise(r => setTimeout(r, 250))

  const out = await page.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.h || r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } }
    const list = document.querySelector('[data-sh-skill-menu-list]:not([hidden])')
    const active = document.activeElement
    const l = box(list), a = box(active)
    return {
      open: !!list,
      focused: active.className,
      label: (active.textContent || '').trim(),
      stripe: getComputedStyle(active).boxShadow,
      insideSurface: a.left >= l.left && a.right <= l.right && a.top >= l.top && a.bottom <= l.bottom,
      surface: l
    }
  })

  console.log('menu open       ', out.open)
  console.log('focused item    ', out.label, '|', out.focused)
  console.log('focus stripe    ', out.stripe)
  console.log('item within box ', out.insideSurface)

  await page.screenshot({
    path: 'artifacts/shots/skill-menu-a-keyboard.png',
    clip: { x: out.surface.left - 40, y: out.surface.top - 40, width: 260, height: out.surface.bottom - out.surface.top + 80 }
  })

  // Escape returns focus to the trigger.
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, 250))
  const closed = await page.evaluate(() => ({
    hidden: !document.querySelector('[data-sh-skill-menu-list]:not([hidden])'),
    focus: document.activeElement.getAttribute('data-sh-skill-menu-trigger') !== null
  }))
  console.log('escape closes   ', closed.hidden, '| focus back on trigger', closed.focus)

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
