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

  const clip = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('#sh-skill-editor-doc a'))
      .filter(a => /GTM Profile/.test(a.textContent))
    if (!links.length) return { count: 0 }
    links[0].scrollIntoView({ block: 'center' })
    const first = links[0].getBoundingClientRect()
    const last = links[links.length - 1].getBoundingClientRect()
    return {
      count: links.length,
      color: getComputedStyle(links[0]).color,
      decoration: getComputedStyle(links[0]).textDecorationLine,
      x: Math.max(0, first.left - 40),
      y: Math.max(0, first.top - 20),
      width: 520,
      height: (last.bottom - first.top) + 40
    }
  })
  console.log('links', clip.count, '| color', clip.color, '| decoration', clip.decoration)
  if (clip.count) {
    await new Promise(r => setTimeout(r, 200))
    await page.screenshot({ path: 'artifacts/shots/gtm-profile-links.png', clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } })
    console.log('shot gtm-profile-links')
  }
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
