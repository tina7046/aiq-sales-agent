const puppeteer = require('puppeteer')
;(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3002/skills.html', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 400))
  const info = await page.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item[data-sh-skill-id]')
    item.classList.add('is-menu-open')
    const list = item.querySelector('.seller-home__skill-menu-list')
    if (list) { list.hidden = false; list.classList.add('is-open') }
    const rows = Array.from(list.querySelectorAll('.seller-home__skill-menu-item')).map(btn => {
      const use = btn.querySelector('use')
      const href = use ? (use.getAttribute('xlink:href') || use.getAttribute('href')) : null
      return { action: btn.getAttribute('data-sh-skill-action'), label: btn.querySelector('.seller-home__skill-menu-item-label').textContent.trim(), icon: href ? href.split('#')[1] : null }
    })
    const r = list.getBoundingClientRect()
    return { rows, clip: { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), width: r.width + 24, height: r.height + 24 } }
  })
  await page.screenshot({ path: 'artifacts/shots/skill-menu-items.png', clip: info.clip })
  delete info.clip
  console.log(JSON.stringify(info, null, 2))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
