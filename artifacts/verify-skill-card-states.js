const puppeteer = require('puppeteer')

const RGB_WASH = 'rgb(243, 243, 243)' // #f3f3f3 surface-container-2
const RGB_REST = 'rgb(255, 255, 255)' // #ffffff surface-1
const RGB_CIRCLE = 'rgb(229, 229, 229)' // #e5e5e5

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3002/skills.html', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 400))

  const rowSel = '.seller-home__skill-item[data-sh-skill-id] .seller-home__skill-row:not(.seller-home__skill-row--unlinked)'
  const kebabSel = '.seller-home__skill-item .seller-home__skill-menu-trigger'
  const chevSel = '.seller-home__skill-item .seller-home__skill-chevron'

  const read = (sel, prop) => page.evaluate((s, p) => {
    const el = document.querySelector(s)
    return el ? getComputedStyle(el)[p] : null
  }, sel, prop)

  const clip = await page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect()
    return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), width: r.width + 24, height: r.height + 24 }
  }, rowSel)

  // 1) REST
  const restBg = await read(rowSel, 'backgroundColor')
  const kebabRestOpacity = await read(kebabSel, 'opacity')
  await page.screenshot({ path: 'artifacts/shots/v1-card-rest.png', clip })

  // 2) CARD HOVER (hover the description area = card body)
  await page.hover('.seller-home__skill-item .seller-home__skill-description')
  await new Promise(r => setTimeout(r, 250))
  const hoverBg = await read(rowSel, 'backgroundColor')
  const kebabHoverOpacity = await read(kebabSel, 'opacity')
  const chevronOpacity = await read(chevSel, 'opacity')
  await page.screenshot({ path: 'artifacts/shots/v1-card-hover.png', clip })

  // 3) KEBAB HOVER — card must stay washed, circle #e5e5e5
  await page.hover(kebabSel)
  await new Promise(r => setTimeout(r, 250))
  const rowBgWhileKebab = await read(rowSel, 'backgroundColor')
  const circleBg = await read(kebabSel, 'backgroundColor')
  await page.screenshot({ path: 'artifacts/shots/v1-kebab-hover.png', clip })

  console.log(JSON.stringify({
    rest: { rowBg: restBg, expectRest: restBg === RGB_REST, kebabHidden: kebabRestOpacity === '0' },
    cardHover: { rowBg: hoverBg, washOn: hoverBg === RGB_WASH, kebabShown: kebabHoverOpacity === '1', chevronShown: chevronOpacity === '1' },
    kebabHover: { rowBgStaysWashed: rowBgWhileKebab === RGB_WASH, rowBg: rowBgWhileKebab, circleBg, circleIsE5: circleBg === RGB_CIRCLE }
  }, null, 2))

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
