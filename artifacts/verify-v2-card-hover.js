// Version B skill-card interaction states: rest, card hover, each icon
// hover, layout-shift, keyboard, and "clicking an action does not
// navigate".
const puppeteer = require('puppeteer')

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function rgb(el, prop) {
  return getComputedStyle(el)[prop]
}

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chrome
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
  await page.goto('http://localhost:4477/skills-v2.html', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 400))

  const rest = await page.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item')
    const row = item.querySelector('.seller-home__skill-row')
    const use = item.querySelector('.seller-home__skill-action-use')
    const keb = item.querySelector('[data-sh-skill-menu-trigger]')
    const desc = item.querySelector('.seller-home__skill-description')
    const cs = el => getComputedStyle(el)
    return {
      count: document.querySelectorAll('.seller-home__skill-item .seller-home__skill-action-use').length,
      cards: document.querySelectorAll('.seller-home__skill-item').length,
      rowBg: cs(row).backgroundColor,
      useOp: cs(use).opacity,
      kebOp: cs(keb).opacity,
      usePe: cs(use).pointerEvents,
      kebPe: cs(keb).pointerEvents,
      useAria: use.getAttribute('aria-label'),
      useTitle: use.getAttribute('title'),
      kebTitle: keb.getAttribute('title'),
      descRight: Math.round(desc.getBoundingClientRect().right),
      useBox: use.getBoundingClientRect().width + 'x' + use.getBoundingClientRect().height,
      hiddenAttr: use.hasAttribute('hidden') || use.getAttribute('aria-hidden')
    }
  })
  console.log('REST', JSON.stringify(rest, null, 2))

  const item = await page.$('.seller-home__skill-item')
  const ib = await item.boundingBox()
  const clip = { x: ib.x, y: ib.y - 8, width: ib.width + 80, height: ib.height + 16 }
  await page.screenshot({ path: 'artifacts/shots/v2-card-rest.png', clip })

  // Card hover (text, not the buttons).
  await page.hover('.seller-home__skill-item .seller-home__skill-title')
  await new Promise(r => setTimeout(r, 250))
  const cardHover = await page.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item')
    const row = item.querySelector('.seller-home__skill-row')
    const use = item.querySelector('.seller-home__skill-action-use')
    const keb = item.querySelector('[data-sh-skill-menu-trigger]')
    const desc = item.querySelector('.seller-home__skill-description')
    const cs = el => getComputedStyle(el)
    return {
      rowBg: cs(row).backgroundColor,
      useOp: cs(use).opacity,
      kebOp: cs(keb).opacity,
      useBg: cs(use).backgroundColor,
      kebBg: cs(keb).backgroundColor,
      descRight: Math.round(desc.getBoundingClientRect().right)
    }
  })
  console.log('CARD HOVER', JSON.stringify(cardHover))
  await page.screenshot({ path: 'artifacts/shots/v2-card-hover.png', clip })

  // Use Skill hover.
  await page.hover('.seller-home__skill-action-use')
  await new Promise(r => setTimeout(r, 250))
  const useHover = await page.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item')
    const row = item.querySelector('.seller-home__skill-row')
    const use = item.querySelector('.seller-home__skill-action-use')
    const keb = item.querySelector('[data-sh-skill-menu-trigger]')
    const cs = el => getComputedStyle(el)
    return {
      rowBg: cs(row).backgroundColor,
      useOp: cs(use).opacity,
      kebOp: cs(keb).opacity,
      useBg: cs(use).backgroundColor,
      kebBg: cs(keb).backgroundColor
    }
  })
  console.log('USE HOVER', JSON.stringify(useHover))
  await page.screenshot({ path: 'artifacts/shots/v2-card-use-hover.png', clip })

  // Kebab hover.
  await page.hover('[data-sh-skill-menu-trigger]')
  await new Promise(r => setTimeout(r, 250))
  const kebHover = await page.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item')
    const row = item.querySelector('.seller-home__skill-row')
    const use = item.querySelector('.seller-home__skill-action-use')
    const keb = item.querySelector('[data-sh-skill-menu-trigger]')
    const cs = el => getComputedStyle(el)
    return {
      rowBg: cs(row).backgroundColor,
      useOp: cs(use).opacity,
      kebOp: cs(keb).opacity,
      useBg: cs(use).backgroundColor,
      kebBg: cs(keb).backgroundColor
    }
  })
  console.log('KEBAB HOVER', JSON.stringify(kebHover))
  await page.screenshot({ path: 'artifacts/shots/v2-card-kebab-hover.png', clip })

  // Open menu — card wash stays, no navigation.
  const navPromise = page.waitForNavigation({ timeout: 800 }).then(() => 'NAVIGATED').catch(() => 'no-nav')
  await page.click('[data-sh-skill-menu-trigger]')
  const nav = await navPromise
  await new Promise(r => setTimeout(r, 300))
  const menuOpen = await page.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item')
    const row = item.querySelector('.seller-home__skill-row')
    const menu = item.querySelector('[data-sh-skill-menu-list]')
    const keb = item.querySelector('[data-sh-skill-menu-trigger]')
    return {
      openClass: item.classList.contains('is-menu-open'),
      menuHidden: menu.hidden,
      rowBg: getComputedStyle(row).backgroundColor,
      kebBg: getComputedStyle(keb).backgroundColor,
      kebOp: getComputedStyle(keb).opacity,
      href: location.pathname
    }
  })
  console.log('MENU OPEN', nav, JSON.stringify(menuOpen))
  const mb = await page.$('[data-sh-skill-menu-list]:not([hidden])')
  const mbox = mb && await mb.boundingBox()
  if (mbox) {
    await page.screenshot({
      path: 'artifacts/shots/v2-card-menu-open.png',
      clip: {
        x: ib.x,
        y: ib.y - 8,
        width: ib.width + 80,
        height: Math.max(ib.height, mbox.y + mbox.height - ib.y) + 24
      }
    })
  }

  // Hover a menu item — wash must stay.
  await page.hover('[data-sh-skill-menu-list] [data-sh-skill-action]')
  await new Promise(r => setTimeout(r, 200))
  const menuItemHover = await page.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item')
    const row = item.querySelector('.seller-home__skill-row')
    return { rowBg: getComputedStyle(row).backgroundColor, open: item.classList.contains('is-menu-open') }
  })
  console.log('MENU ITEM HOVER', JSON.stringify(menuItemHover))

  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, 200))

  // Use Skill click must not navigate.
  const useNav = page.waitForNavigation({ timeout: 800 }).then(() => 'NAVIGATED').catch(() => 'no-nav')
  const fired = await page.evaluate(() => new Promise(res => {
    document.addEventListener('sh:skill-use-in-chat', () => res('use-in-chat'), { once: true })
    document.addEventListener('sh:skill-action', e => res('skill-action:' + (e.detail && e.detail.action)), { once: true })
    document.querySelector('.seller-home__skill-action-use').click()
    setTimeout(() => res('no-event'), 700)
  }))
  console.log('USE CLICK', await useNav, fired)

  // Keyboard: tab to the first Use Skill from the row link.
  await page.focus('.seller-home__skill-item .seller-home__skill-row')
  await page.keyboard.press('Tab')
  await new Promise(r => setTimeout(r, 200))
  const kb = await page.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item')
    const row = item.querySelector('.seller-home__skill-row')
    const active = document.activeElement
    return {
      active: active.className,
      rowBg: getComputedStyle(row).backgroundColor,
      useOp: getComputedStyle(item.querySelector('.seller-home__skill-action-use')).opacity,
      kebOp: getComputedStyle(item.querySelector('[data-sh-skill-menu-trigger]')).opacity,
      useBg: getComputedStyle(item.querySelector('.seller-home__skill-action-use')).backgroundColor
    }
  })
  console.log('KEYBOARD FOCUS USE', JSON.stringify(kb))
  await page.screenshot({ path: 'artifacts/shots/v2-card-keyboard-use.png', clip })

  // Version A must still show kebab only on hover, no Use Skill.
  const pageA = await browser.newPage()
  await pageA.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
  await pageA.goto('http://localhost:4477/skills.html', { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 300))
  const aRest = await pageA.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item')
    return {
      use: !!item.querySelector('.seller-home__skill-action-use'),
      kebOp: getComputedStyle(item.querySelector('[data-sh-skill-menu-trigger]')).opacity
    }
  })
  await pageA.hover('.seller-home__skill-item .seller-home__skill-title')
  await new Promise(r => setTimeout(r, 250))
  const aHover = await pageA.evaluate(() => {
    const item = document.querySelector('.seller-home__skill-item')
    const keb = item.querySelector('[data-sh-skill-menu-trigger]')
    return {
      kebOp: getComputedStyle(keb).opacity,
      kebBg: getComputedStyle(keb).backgroundColor
    }
  })
  await pageA.hover('[data-sh-skill-menu-trigger]')
  await new Promise(r => setTimeout(r, 250))
  const aKeb = await pageA.evaluate(() => {
    const keb = document.querySelector('[data-sh-skill-menu-trigger]')
    return { kebBg: getComputedStyle(keb).backgroundColor }
  })
  console.log('VERSION A rest', JSON.stringify(aRest), 'hover', JSON.stringify(aHover), 'kebHover', JSON.stringify(aKeb))

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
