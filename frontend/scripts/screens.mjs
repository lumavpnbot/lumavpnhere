// Скриншоты экранов для визуальной проверки (запускается в CI, см. preview-screens.yml).
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:4173/'
const ROUTES = [
  ['home', '#/'],
  ['plans', '#/plans'],
  ['devices', '#/devices'],
  ['connect', '#/connect'],
  ['referrals', '#/referrals'],
  ['account', '#/account'],
]

mkdirSync('shots', { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 })
const page = await context.newPage()

for (const [name, hash] of ROUTES) {
  await page.goto(BASE + hash)
  await page.waitForTimeout(1200) // шрифт + анимация входа страницы
  await page.screenshot({ path: `shots/${name}.png` })
  await page.screenshot({ path: `shots/${name}-full.png`, fullPage: true })
}

await browser.close()
