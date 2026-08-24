// Version B action cluster after "Use Skill" became an icon button:
// geometry of the pair, resting vs hovered paint, and the accessible name.
const puppeteer = require('puppeteer')

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 3 })
  await page.goto('http://localhost:4477/skills-v2.html', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 400))

  const read = () => page.evaluate(() => {
    const card = document.querySelector('.seller-home__skill-item')
    const cr = card.getBoundingClientRect()
    const use = card.querySelector('.seller-home__skill-action-use')
    const keb = card.querySelector('[data-sh-skill-menu-trigger]')
    const desc = card.querySelector('.seller-home__skill-body')
    const g = el => {
      const svg = el.querySelector('.slds-button__icon')
      const s = getComputedStyle(svg)
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
        near: Math.round(cr.right - r.right),
        far: Math.round(cr.right - r.left),
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
        glyph: `${s.width}x${s.height}`,
        fill: s.fill,
        href: svg.querySelector('use').getAttribute('xlink:href').split('#')[1]
      }
    }
    return {
      use: g(use),
      kebab: g(keb),
      gap: Math.round(keb.getBoundingClientRect().left - use.getBoundingClientRect().right),
      name: use.getAttribute('aria-label'),
      srText: use.querySelector('.slds-assistive-text').textContent,
      visibleText: use.textContent.trim(),
      action: use.getAttribute('data-sh-skill-action'),
      descPadEnd: getComputedStyle(desc).paddingInlineEnd
    }
  })

  const rest = await read()
  console.log('── at rest ──')
  console.log(`  Use Skill  ${rest.use.box} radius=${rest.use.radius} bg=${rest.use.bg}`)
  console.log(`             glyph=${rest.use.glyph} fill=${rest.use.fill} sprite=#${rest.use.href}`)
  console.log(`             offsets near=${rest.use.near} far=${rest.use.far}`)
  console.log(`  kebab      ${rest.kebab.box} bg=${rest.kebab.bg} glyph fill=${rest.kebab.fill} sprite=#${rest.kebab.href}`)
  console.log(`  gap between buttons: ${rest.gap}px | text column pad-end: ${rest.descPadEnd}`)
  console.log(`  accessible name: "${rest.name}" | sr text: "${rest.srText}" | action: ${rest.action}`)

  const card = await page.$('.seller-home__skill-item')
  const cb = await card.boundingBox()
  const clip = { x: cb.x + cb.width - 300, y: cb.y - 8, width: 310, height: cb.height + 16 }
  await page.screenshot({ path: 'artifacts/shots/use-skill-icon-rest.png', clip })

  await page.hover('.seller-home__skill-action-use')
  await new Promise(r => setTimeout(r, 300))
  const hov = await read()
  console.log('\n── hovering "Use Skill" ──')
  console.log(`  bg=${hov.use.bg} glyph fill=${hov.use.fill}`)
  console.log(`  kebab unchanged: bg=${hov.kebab.bg} fill=${hov.kebab.fill}`)
  await page.screenshot({ path: 'artifacts/shots/use-skill-icon-hover.png', clip })

  // Click still routes the original action event.
  const fired = await page.evaluate(() => new Promise(res => {
    document.addEventListener('sh:skill-use-in-chat', e => res(e.detail && e.detail.id || true), { once: true })
    document.addEventListener('sh:skill-action', e => res('sh:skill-action ' + (e.detail && e.detail.action)), { once: true })
    document.querySelector('.seller-home__skill-action-use').click()
    setTimeout(() => res('no event'), 900)
  }))
  console.log(`\n  click dispatches: ${fired}`)

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
