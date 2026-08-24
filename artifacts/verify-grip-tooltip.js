const puppeteer = require('puppeteer')

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 3 })
  await page.goto('http://localhost:3002/skill_detail.html?id=sk-daily-deal-summary', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 600))

  // Force the first grip's hover tooltip to stay visible for capture.
  await page.addStyleTag({ content: '.seller-home__skill-block-grip-hint{display:flex!important}' })

  const data = await page.evaluate(() => {
    const grip = document.querySelector('#sh-skill-editor-doc [data-sh-skill-block-grip]')
    grip.scrollIntoView({ block: 'center' })
    const hint = grip.querySelector('.seller-home__skill-block-grip-hint')
    const slashes = hint.querySelectorAll('.seller-home__skill-block-slash')
    const cmd = slashes[0], sl = slashes[1]
    const rc = cmd.getBoundingClientRect(), rs = sl.getBoundingClientRect()
    const cs = getComputedStyle(cmd)
    return {
      cmd: { w: +rc.width.toFixed(1), h: +rc.height.toFixed(1), text: cmd.textContent },
      slash: { w: +rs.width.toFixed(1), h: +rs.height.toFixed(1), text: sl.textContent },
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight
    }
  })
  console.log(JSON.stringify(data, null, 2))

  const clip = await page.evaluate(() => {
    const hint = document.querySelector('#sh-skill-editor-doc [data-sh-skill-block-grip] .seller-home__skill-block-grip-hint')
    const r = hint.getBoundingClientRect()
    return { x: Math.max(0, r.left - 24), y: Math.max(0, r.top - 12), width: Math.ceil(r.width) + 48, height: Math.ceil(r.height) + 24 }
  })
  await new Promise(r => setTimeout(r, 150))
  await page.screenshot({ path: 'artifacts/shots/grip-tooltip.png', clip })
  console.log('shot', JSON.stringify(clip))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
