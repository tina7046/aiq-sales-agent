const puppeteer = require('puppeteer')
;(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3002/skill_detail.html?id=sk-daily-pipeline-snapshot', { waitUntil: 'networkidle0' })
  await page.evaluate(() => { const t = document.querySelector('.seller-home__skill-detail-schedule-trigger'); if (t) t.classList.add('slds-is-open') })
  await new Promise(r => setTimeout(r, 250))
  const data = await page.evaluate(() => {
    const out = {}
    const labels = Array.from(document.querySelectorAll('.seller-home__skill-detail-schedule-trigger .slds-dropdown .slds-truncate'))
    out.labels = labels.map(el => { const cs = getComputedStyle(el); return { text: el.textContent.trim(), fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color } })
    const bm = document.querySelector('.seller-home__skill-block-menu-title')
    out.blockMenuTitleColor = bm ? getComputedStyle(bm).color : null
    return out
  })
  console.log(JSON.stringify(data, null, 2))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
