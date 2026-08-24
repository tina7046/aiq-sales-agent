// Open the block-tunes (grip) menu and the toolbox (+) menu on the skill
// detail page and screenshot each, so we can eyeball the ce-popover refinements.
const puppeteer = require('puppeteer')

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3002/skill_detail.html?id=sk-daily-deal-summary', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 600))

  async function shoot(name, panelSel) {
    const clip = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.max(0, r.left - 24), y: Math.max(0, r.top - 24), width: r.width + 48, height: r.height + 48 }
    }, panelSel)
    if (!clip) { console.log('MISSING', name); return }
    await page.screenshot({ path: 'artifacts/shots/' + name + '.png', clip })
    console.log('shot', name, JSON.stringify(clip))
  }

  // Block-tunes menu — click a grip midway down the doc.
  const grips = await page.$$('[data-sh-skill-block-grip]')
  console.log('grips', grips.length)
  const grip = grips[4] || grips[0]
  await grip.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await new Promise(r => setTimeout(r, 200))
  await grip.click()
  await new Promise(r => setTimeout(r, 350))
  await shoot('popover-block-tunes', '[data-sh-skill-block-menu]:not([hidden])')

  // Toolbox menu — click the + on the same block.
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, 250))
  const plusList = await page.$$('[data-sh-skill-block-plus]')
  const plus = plusList[4] || plusList[0]
  await plus.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await new Promise(r => setTimeout(r, 200))
  await plus.click()
  await new Promise(r => setTimeout(r, 350))
  await shoot('popover-toolbox', '[data-sh-skill-block-convert]:not([hidden])')

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
