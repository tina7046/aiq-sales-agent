const puppeteer = require('puppeteer')

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3002/skill_detail.html?id=sk-daily-deal-summary', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 500))

  // Force the More dropdown open for capture.
  await page.evaluate(() => {
    const trig = document.querySelector('.seller-home__skill-detail-schedule-trigger')
    if (trig) trig.classList.add('slds-is-open')
  })
  await new Promise(r => setTimeout(r, 250))

  const info = await page.evaluate(() => {
    const dd = document.querySelector('.seller-home__skill-detail-schedule-trigger .slds-dropdown')
    if (!dd) return { found: false }
    const icon = dd.querySelector('.slds-icon')
    const r = dd.getBoundingClientRect()
    return {
      found: true,
      border: getComputedStyle(dd).border,
      iconFill: icon ? getComputedStyle(icon).fill : null,
      clip: { x: Math.max(0, r.left - 16), y: Math.max(0, r.top - 16), width: r.width + 32, height: r.height + 32 }
    }
  })
  console.log('border', info.border, '| icon fill', info.iconFill)
  if (info.found) {
    await page.screenshot({ path: 'artifacts/shots/more-menu.png', clip: info.clip })
    console.log('shot more-menu')
  }
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
