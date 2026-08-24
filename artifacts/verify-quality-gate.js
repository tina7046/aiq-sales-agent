const puppeteer = require('puppeteer')

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3002/skill_detail.html?id=sk-daily-deal-summary', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 600))

  const info = await page.evaluate(() => {
    const list = document.querySelector('#sh-skill-editor-doc ul.seller-home__skill-check-list')
    if (!list) return { found: false }
    list.scrollIntoView({ block: 'start' })
    const items = list.querySelectorAll('.seller-home__skill-check-item')
    const box = list.querySelector('.seller-home__skill-check-box')
    const r = list.getBoundingClientRect()
    return {
      found: true,
      itemCount: items.length,
      boxW: box ? getComputedStyle(box).width : null,
      boxBorder: box ? getComputedStyle(box).border : null,
      clip: { x: Math.max(0, r.left - 30), y: Math.max(0, r.top - 60), width: Math.min(1000, r.width + 60), height: r.height + 80 }
    }
  })
  console.log('checklist found', info.found, '| items', info.itemCount, '| box', info.boxW, '|', info.boxBorder)
  if (info.found) {
    // Toggle the first checkbox to confirm interactivity + persistence.
    await page.click('#sh-skill-editor-doc ul.seller-home__skill-check-list .seller-home__skill-check-box')
    await new Promise(r => setTimeout(r, 200))
    const firstChecked = await page.evaluate(() =>
      document.querySelector('#sh-skill-editor-doc ul.seller-home__skill-check-list .seller-home__skill-check-item').getAttribute('data-checked'))
    console.log('first item after click data-checked =', firstChecked)
    await new Promise(r => setTimeout(r, 200))
    await page.screenshot({ path: 'artifacts/shots/quality-gate-checklist.png', clip: info.clip })
    console.log('shot quality-gate-checklist')
  }
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
