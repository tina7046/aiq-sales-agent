// Version A footer-row geometry around the kebab, plus Version B's trigger for
// reference. Offsets are reported as distance INWARD from the card's right edge
// so they can be compared against the `right:` / `margin-right:` values in
// skills.scss directly.
const puppeteer = require('puppeteer')

const PAGES = [
  ['A', 'http://localhost:4477/skills.html'],
  ['B', 'http://localhost:4477/skills-v2.html']
]

;(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })

  for (const [name, url] of PAGES) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
    await page.goto(url, { waitUntil: 'networkidle0' })
    await new Promise(r => setTimeout(r, 400))

    // Hover the card so the reveal-on-hover affordances are measurable.
    await page.hover('.seller-home__skill-item')
    await new Promise(r => setTimeout(r, 300))

    const m = await page.evaluate(() => {
      const card = document.querySelector('.seller-home__skill-item')
      const cardR = card.getBoundingClientRect()
      // Distance from the card's right edge, growing leftward.
      const inward = el => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          // near = closest edge to the card's right side
          near: Math.round(cardR.right - r.right),
          far: Math.round(cardR.right - r.left)
        }
      }
      const q = s => card.querySelector(s)
      const trigger = q('[data-sh-skill-menu-trigger]')
      const wrap = q('.seller-home__skill-menu')
      const uses = q('.seller-home__skill-uses') || q('[class*="skill-uses"]') || q('[class*="skill-refers"]')
      const usesWrap = uses && uses.parentElement
      const cs = trigger ? getComputedStyle(trigger) : {}
      return {
        cardW: Math.round(cardR.width),
        padRight: getComputedStyle(card.querySelector('a, .seller-home__skill-row') || card).paddingRight,
        chevron: inward(q('.seller-home__skill-chevron')),
        wrapper: inward(wrap),
        trigger: inward(trigger),
        glyph: inward(trigger && trigger.querySelector('.slds-button__icon')),
        useSkill: inward(q('.seller-home__skill-use-button, [class*="skill-use"]')),
        usesLabel: inward(uses),
        usesLabelClass: uses ? uses.className : null,
        usesWrapper: inward(usesWrap),
        usesWrapperClass: usesWrap ? usesWrap.className : null,
        usesWrapperMarginRight: usesWrap ? getComputedStyle(usesWrap).marginRight : null,
        triggerSize: `${cs.width} x ${cs.height}`,
        triggerRadius: cs.borderRadius,
        triggerBg: cs.backgroundColor
      }
    })

    console.log(`\n══ Version ${name} ══  (offsets = px inward from card's right edge)`)
    console.log(`  card width        ${m.cardW}`)
    const fmt = (k, v) => v ? `  ${k.padEnd(17)} ${String(v.w).padStart(3)}x${String(v.h).padEnd(3)}  near=${String(v.near).padStart(3)} far=${String(v.far).padStart(3)}` : `  ${k.padEnd(17)} —`
    console.log(fmt('chevron', m.chevron))
    console.log(fmt('kebab wrapper', m.wrapper))
    console.log(fmt('kebab button', m.trigger))
    console.log(fmt('kebab glyph', m.glyph))
    console.log(fmt('"Use Skill"', m.useSkill))
    console.log(fmt('uses label', m.usesLabel))
    console.log(fmt('uses wrapper', m.usesWrapper))
    console.log(`  uses wrapper      class=${m.usesWrapperClass} margin-right=${m.usesWrapperMarginRight}`)
    console.log(`  trigger computed  ${m.triggerSize}  radius=${m.triggerRadius}  bg=${m.triggerBg}`)

    // Gap between the label's right edge and the kebab box's left edge.
    if (m.usesWrapper && m.trigger) {
      console.log(`  GAP label→kebab   ${m.usesWrapper.near - m.trigger.far}px`)
    }
    if (m.trigger && m.chevron) {
      console.log(`  GAP kebab→chevron ${m.trigger.near - m.chevron.far}px`)
    }
    await page.close()
  }

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
