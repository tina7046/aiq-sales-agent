const puppeteer = require('puppeteer')

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage()
  await page.goto('http://localhost:3002/skill_detail.html?id=sk-daily-deal-summary', { waitUntil: 'networkidle0' })

  const out = await page.evaluate(() => {
    function ink(ch, font) {
      const c = document.createElement('canvas')
      c.width = 64; c.height = 64
      const ctx = c.getContext('2d')
      ctx.font = font
      ctx.textBaseline = 'alphabetic'
      const m = ctx.measureText(ch)
      return {
        width: +m.width.toFixed(2),
        inkAscent: +(m.actualBoundingBoxAscent || 0).toFixed(2),
        inkDescent: +(m.actualBoundingBoxDescent || 0).toFixed(2),
        inkHeight: +((m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0)).toFixed(2)
      }
    }
    const fonts = {
      mono11: '600 11px Consolas, Menlo, Monaco, Courier, monospace',
      sans11: '600 11px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }
    const res = {}
    for (const key in fonts) {
      res[key] = { cmd: ink('\u2318', fonts[key]), slash: ink('/', fonts[key]) }
    }
    return res
  })
  console.log(JSON.stringify(out, null, 2))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
