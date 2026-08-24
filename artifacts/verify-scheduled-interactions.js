// The interactions the status button could plausibly break: activating it
// on a LINKED row (must not navigate), keyboard reach and activation, and
// the tab filter it now shares an attribute with.
const puppeteer = require('puppeteer')

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
  await page.goto('http://localhost:4477/scheduled.html', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 500))

  // ── 1. Linked row: pressing the status button must not navigate ──
  const before = page.url()
  const btns = await page.$$('[data-sh-workflow-run-toggle]')
  await btns[0].click()
  await new Promise(r => setTimeout(r, 400))
  const row1 = await page.evaluate(() => {
    const li = document.querySelector('[data-sh-workflow-item]')
    const body = li.querySelector('[data-sh-workflow-status-label]')
    return {
      state: li.getAttribute('data-sh-workflow-status'),
      toggleLabel: li.querySelector('[data-sh-workflow-run-toggle]').getAttribute('aria-label'),
      rowLabel: body && body.getAttribute('aria-label'),
      href: body && body.getAttribute('href')
    }
  })
  console.log('── linked row, status pressed (failed → running) ──')
  console.log('  navigated:', page.url() !== before, '(url unchanged =', page.url() === before, ')')
  console.log('  state:      ', row1.state)
  console.log('  button name:', JSON.stringify(row1.toggleLabel))
  console.log('  row name:   ', JSON.stringify(row1.rowLabel))

  // ── 2. Keyboard: the button is reachable and Enter activates it ──
  await page.reload({ waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 400))
  const kb = await page.evaluate(() => {
    const li = document.querySelectorAll('[data-sh-workflow-item]')[2] // completed
    const btn = li.querySelector('[data-sh-workflow-run-toggle]')
    btn.focus()
    return {
      focused: document.activeElement === btn,
      tabbable: btn.tabIndex >= 0,
      outline: getComputedStyle(btn).outlineWidth
    }
  })
  await page.keyboard.press('Enter')
  await new Promise(r => setTimeout(r, 300))
  const afterEnter = await page.evaluate(() => {
    const li = document.querySelectorAll('[data-sh-workflow-item]')[2]
    return {
      state: li.getAttribute('data-sh-workflow-status'),
      label: li.querySelector('[data-sh-workflow-run-toggle]').getAttribute('aria-label')
    }
  })
  console.log('── keyboard ──')
  console.log(' ', kb, '→ after Enter:', afterEnter)

  // ── 3. Tab filter, on the attribute the status button now writes ──
  await page.reload({ waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 400))
  const filter = async (id) => {
    await page.click(`[data-sh-scheduled-tab="${id}"]`)
    await new Promise(r => setTimeout(r, 250))
    return page.evaluate(() => ({
      visible: [...document.querySelectorAll('[data-sh-workflow-item]')]
        .filter(li => !li.hidden)
        .map(li => li.getAttribute('data-sh-workflow-status')),
      empty: !document.querySelector('[data-sh-scheduled-empty]').hidden
    }))
  }
  console.log('── tab filters ──')
  for (const id of ['need_attention', 'scheduled', 'paused', 'all']) {
    const r = await filter(id)
    console.log(`  ${id.padEnd(15)} → [${r.visible.join(', ')}]${r.empty ? '  + empty panel' : ''}`)
  }

  // A paused row while "Scheduled" is active: stays put, filter re-applies
  // only on the next tab activation.
  await page.click('[data-sh-scheduled-tab="scheduled"]')
  await new Promise(r => setTimeout(r, 250))
  const scheduledBtns = await page.$$('[data-sh-workflow-item]:not([hidden]) [data-sh-workflow-run-toggle]')
  await scheduledBtns[0].click()
  await new Promise(r => setTimeout(r, 350))
  const held = await page.evaluate(() => {
    const li = [...document.querySelectorAll('[data-sh-workflow-item]')].find(
      l => l.getAttribute('data-sh-workflow-status') === 'paused' && !l.hidden)
    return {
      pausedRowStillVisible: !!li,
      title: li && li.querySelector('.seller-home__scheduled-workflow-title').textContent.trim(),
      counts: [...document.querySelectorAll('[data-sh-scheduled-tab-count]')].map(p => p.textContent)
    }
  })
  console.log('── paused while the Scheduled tab is active ──')
  console.log(' ', held)

  await page.screenshot({ path: 'artifacts/shots/scheduled-status-scheduled-tab.png', clip: { x: 380, y: 300, width: 780, height: 320 } })
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
