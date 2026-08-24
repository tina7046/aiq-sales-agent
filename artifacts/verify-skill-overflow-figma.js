const puppeteer = require('puppeteer')
;(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3002/skills.html', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 400))
  // Open the first card's overflow menu.
  const info = await page.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item[data-sh-skill-id]')
    item.classList.add('is-menu-open')
    const list = item.querySelector('.seller-home__skill-menu-list')
    const trigger = item.querySelector('.seller-home__skill-menu-trigger')
    if (trigger) trigger.setAttribute('aria-expanded', 'true')
    if (list) { list.hidden = false; list.classList.add('is-open') }
    const firstIcon = list.querySelector('.seller-home__skill-menu-item:not(.seller-home__skill-menu-item--destructive) .seller-home__skill-menu-item-icon')
    const firstLabel = list.querySelector('.seller-home__skill-menu-item:not(.seller-home__skill-menu-item--destructive) .seller-home__skill-menu-item-label')
    const delRow = list.querySelector('.seller-home__skill-menu-row--destructive')
    const delBtn = list.querySelector('.seller-home__skill-menu-item--destructive')
    const delIcon = list.querySelector('.seller-home__skill-menu-item--destructive .seller-home__skill-menu-item-icon')
    const r = list.getBoundingClientRect()
    return {
      iconFill: firstIcon ? getComputedStyle(firstIcon).fill : null,
      labelColor: firstLabel ? getComputedStyle(firstLabel).color : null,
      deleteColor: delBtn ? getComputedStyle(delBtn).color : null,
      deleteIconFill: delIcon ? getComputedStyle(delIcon).fill : null,
      divBorderTop: delRow ? getComputedStyle(delRow).borderTopWidth + ' ' + getComputedStyle(delRow).borderTopColor : null,
      radius: getComputedStyle(list).borderTopLeftRadius,
      clip: { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), width: r.width + 24, height: r.height + 24 }
    }
  })
  await new Promise(r => setTimeout(r, 150))
  await page.screenshot({ path: 'artifacts/shots/skill-overflow-figma.png', clip: info.clip })
  delete info.clip
  console.log(JSON.stringify(info, null, 2))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
