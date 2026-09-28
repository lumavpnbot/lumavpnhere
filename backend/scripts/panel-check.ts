/**
 * Проверка связи с H1 Panel без запуска всего бэкенда.
 *   H1_PANEL_URL=... H1_PANEL_TOKEN=... npx tsx scripts/panel-check.ts
 * Печатает инбаунды (их id нужны в H1_INBOUND_IDS) и клиентов. Ничего не меняет.
 */
const base = (process.env.H1_PANEL_URL ?? '').replace(/\/+$/, '')
const token = process.env.H1_PANEL_TOKEN ?? ''
if (!base || !token) {
  console.error('Задайте H1_PANEL_URL и H1_PANEL_TOKEN')
  process.exit(1)
}

async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const text = await res.text()
  console.log(`\nGET ${path} → ${res.status}`)
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text.slice(0, 2000))
  }
}

await get('/inbounds')
await get('/clients')

export {}
