// Visual states of the Skills kebab trigger: card-hover (revealed, untouched)
// and kebab-hover (32-px circle painted, accent glyph). Crops the right end of
// the first row so Version A and Version B can be compared side by side.
const puppeteer = require('puppeteer')

const PAGES = [
  ['a', 'http://localhost:4477/skills.html'],
  ['b', 'http://localhost:4477/skills-v2.html']
]

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })

  for (const [name, url] of PAGES) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 3 })
    await page.goto(url, { waitUntil: 'networkidle0' })
    await new Promise(r => setTimeout(r, 400))

    const card = await page.$('.seller-home__skill-item')
    const cb = await card.boundingBox()
    const clip = { x: cb.x + cb.width - 340, y: cb.y - 6, width: 350, height: cb.height + 12 }

    await page.hover('.seller-home__skill-item')
    await new Promise(r => setTimeout(r, 300))
    await page.screenshot({ path: `artifacts/shots/trigger-${name}-revealed.png`, clip })

    await page.hover('[data-sh-skill-menu-trigger]')
    await new Promise(r => setTimeout(r, 300))
    await page.screenshot({ path: `artifacts/shots/trigger-${name}-hover.png`, clip })

    const state = await page.evaluate(() => {
      const t = document.querySelector('[data-sh-skill-menu-trigger]')
      const cs = getComputedStyle(t)
      const g = getComputedStyle(t.querySelector('.slds-button__icon'))
      return { bg: cs.backgroundColor, size: `${cs.width}x${cs.height}`, radius: cs.borderRadius, fill: g.fill, glyph: `${g.width}x${g.height}` }
    })
    console.log(`${name.toUpperCase()} hovered: ${state.size} radius=${state.radius} bg=${state.bg} glyph=${state.glyph} fill=${state.fill}`)

    // Keyboard focus should paint the same circle.
    await page.evaluate(() => document.querySelector('[data-sh-skill-menu-trigger]').blur())
    await page.hover('.seller-home__skills-title, h1, body')
    await page.keyboard.press('Tab')
    await page.focus('[data-sh-skill-menu-trigger]')
    await new Promise(r => setTimeout(r, 250))
    await page.screenshot({ path: `artifacts/shots/trigger-${name}-focus.png`, clip })

    await page.close()
  }

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
