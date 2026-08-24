const puppeteer = require('puppeteer')
;(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3002/skill_detail.html?id=sk-daily-pipeline-snapshot', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 400))
  // Open a block handle (grip) menu to render .seller-home__skill-block-menu with items.
  const data = await page.evaluate(async () => {
    const grip = document.querySelector('.seller-home__skill-block-grip')
    if (grip) grip.click()
    await new Promise(r => setTimeout(r, 300))
    const title = document.querySelector('.seller-home__skill-block-menu-title')
    if (!title) return { found: false }
    const cs = getComputedStyle(title)
    return { found: true, text: title.textContent, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, fontFamily: cs.fontFamily }
  })
  console.log(JSON.stringify(data, null, 2))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
