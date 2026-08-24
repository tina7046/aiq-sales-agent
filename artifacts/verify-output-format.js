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

  const info = await page.evaluate(() => {
    const pres = Array.from(document.querySelectorAll('#sh-skill-editor-doc pre'))
      .filter(p => /Prospect List|Review Required/.test(p.textContent))
    if (!pres.length) return { found: false }
    const first = pres[0]
    first.scrollIntoView({ block: 'start' })
    const code = first.querySelector('code') || first
    return {
      found: true,
      count: pres.length,
      color: getComputedStyle(code).color,
      bg: getComputedStyle(first).backgroundColor,
      whiteSpace: getComputedStyle(code).whiteSpace,
      scrollW: first.scrollWidth,
      clientW: first.clientWidth,
      overflows: first.scrollWidth > first.clientWidth + 1
    }
  })
  console.log('pre blocks', info.count, '| color', info.color, '| white-space', info.whiteSpace, '| overflows-x', info.overflows, '(', info.scrollW, '>', info.clientW, ')')
  if (info.found) {
    await new Promise(r => setTimeout(r, 300))
    await page.screenshot({ path: 'artifacts/shots/output-format-code.png' })
    console.log('shot output-format-code')
  }
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
