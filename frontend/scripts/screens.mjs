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
  ['balance', '#/balance'],
  ['notifications', '#/account/notifications'],
  ['logins', '#/account/logins'],
]

mkdirSync('shots', { recursive: true })
const browser = await chromium.launch()

for (const lang of ['ru', 'en']) {
  const context = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 })
  await context.addInitScript((l) => localStorage.setItem('lynk.lang', l), lang)
  const page = await context.newPage()

  for (const [name, hash] of ROUTES) {
    await page.goto(BASE + hash)
    await page.waitForTimeout(900)
    await page.screenshot({ path: `shots/${lang}-${name}.png` })
    if (lang === 'ru') await page.screenshot({ path: `shots/${lang}-${name}-full.png`, fullPage: true })
  }

  // Шторка выбора языка в настройках аккаунта.
  await page.goto(BASE + '#/account')
  await page.waitForTimeout(700)
  await page.getByText(lang === 'ru' ? 'Язык' : 'Language', { exact: true }).first().click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `shots/${lang}-lang-sheet.png` })

  // Запуск как из Telegram: hash с параметрами должен открыть главную с таб-баром.
  await page.goto(BASE + '#tgWebAppData=query_id%3DX&tgWebAppVersion=8.0&tgWebAppPlatform=ios')
  await page.waitForTimeout(900)
  await page.screenshot({ path: `shots/${lang}-tg-launch.png` })

  await context.close()
}

await browser.close()
