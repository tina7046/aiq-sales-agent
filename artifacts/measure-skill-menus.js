// Side-by-side geometry of the Skills overflow menu in both versions, so
// the Version A alignment is driven by measurements rather than guesses.
const puppeteer = require('puppeteer')

const PAGES = [
  ['A', 'http://localhost:4477/skills.html'],
  ['B', 'http://localhost:4477/skills-v2.html']
]

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })

  for (const [name, url] of PAGES) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
    await page.goto(url, { waitUntil: 'networkidle0' })
    await new Promise(r => setTimeout(r, 500))

    // Open the first row's menu.
    const trigger = await page.$('[data-sh-skill-menu-trigger]')
    await trigger.click()
    await new Promise(r => setTimeout(r, 400))

    const m = await page.evaluate(() => {
      const box = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) } }
      const list = document.querySelector('[data-sh-skill-menu-list]:not([hidden])')
      const trig = document.querySelector('[data-sh-skill-menu-trigger]')
      const glyph = trig.querySelector('.slds-button__icon')
      const item = list.querySelector('.seller-home__skill-menu-item')
      const icon = item.querySelector('.seller-home__skill-menu-item-icon')
      const card = document.querySelector('.seller-home__skill-item')
      const cs = getComputedStyle(list)
      const is = getComputedStyle(item)
      return {
        card: box(card),
        trigger: box(trig),
        glyph: box(glyph),
        list: box(list),
        radius: cs.borderTopLeftRadius,
        shadow: cs.boxShadow,
        minWidth: cs.minWidth,
        overflow: cs.overflow,
        border: cs.border,
        padBlock: cs.paddingBlock || cs.paddingTop,
        item: { box: box(item), font: is.fontSize, line: is.lineHeight, pad: is.padding },
        icon: box(icon),
        // What the seller actually sees: gap from the glyph's bottom edge
        // to the menu's top edge, and how far the menu overhangs the card.
        gapUnderGlyph: Math.round(box(list).y - box(glyph).bottom),
        gapUnderTrigger: Math.round(box(list).y - box(trig).bottom),
        overhangRight: Math.round(box(list).right - box(card).right)
      }
    })

    console.log(`\n══ Version ${name} ══`)
    console.log(`  card         ${m.card.w}x${m.card.h} right=${m.card.right}`)
    console.log(`  trigger      ${m.trigger.w}x${m.trigger.h}  glyph ${m.glyph.w}x${m.glyph.h}`)
    console.log(`  menu         ${m.list.w}x${m.list.h}  left=${m.list.x} right=${m.list.right}`)
    console.log(`  radius       ${m.radius}   min-width=${m.minWidth}  overflow=${m.overflow}`)
    console.log(`  border       ${m.border}`)
    console.log(`  shadow       ${m.shadow}`)
    console.log(`  pad-block    ${m.padBlock}`)
    console.log(`  item         ${m.item.box.w}x${m.item.box.h}  font=${m.item.font} line=${m.item.line} pad=${m.item.pad}`)
    console.log(`  item icon    ${m.icon.w}x${m.icon.h}`)
    console.log(`  gap: glyph→menu ${m.gapUnderGlyph}px | trigger→menu ${m.gapUnderTrigger}px | overhang past card ${m.overhangRight}px`)

    await page.screenshot({ path: `artifacts/shots/skill-menu-${name.toLowerCase()}-after.png`, clip: { x: Math.max(0, m.list.x - 200), y: m.trigger.y - 30, width: 520, height: m.list.h + 90 } })
    await page.close()
  }

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
