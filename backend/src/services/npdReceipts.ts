import crypto from 'node:crypto'
import type { Payment, PaymentMethod, PrismaClient } from '@prisma/client'
import { recordError } from '@/lib/errors'
import { productTitle } from './billing'
import type { SettingsService } from './settings'

/**
 * Чеки самозанятого в «Мой налог» (НПД). ЮKassa с 29.12.2025 больше не отправляет их сама,
 * поэтому после каждой оплаты рублями регистрируем доход сами через API личного кабинета
 * lknpd.nalog.ru (тот же, что у веб-версии «Мой налог»; официального публичного API у ФНС нет,
 * формат сверен с библиотекой shoman4eg/moy-nalog).
 *
 * Два способа подключения:
 * - ключ доступа (без пароля): владелец в /admin → Настройки → Чеки вводит телефон из «Мой налог»
 *   и код из SMS, ФНС выдаёт бессрочный refresh-токен. Он хранится в БД зашифрованным
 *   (ключ шифрования из токена бота) и привязан к id «устройства», с которого получен;
 * - ИНН и пароль: переменные MOY_NALOG_INN и MOY_NALOG_PASSWORD.
 * Если есть оба, работает ключ доступа, а пароль остаётся запасным.
 *
 * Чеки выдаются только по оплатам после включения (settings.npdEnabledAt), на сумму,
 * реально полученную от покупателя (без части с внутреннего баланса).
 */

/** Способы, где покупатель платит рублями: по ним самозанятый получает доход и выдаёт чек. */
const RUB_METHODS: PaymentMethod[] = ['platega', 'platega_sbp', 'yookassa_sbp', 'yookassa_card']
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
/** После стольких неудач подряд автоповтор прекращается (чек можно выдать кнопкой в админке). */
const MAX_ATTEMPTS = 5
/** Строка в таблице settings с ключом доступа (вне AppSettings, чтобы ключ не попадал в общие настройки). */
const KEY_ROW = 'npdAccessKey'

export type CancelReason = 'refund' | 'mistake'
const CANCEL_COMMENT: Record<CancelReason, string> = { refund: 'Возврат средств', mistake: 'Чек сформирован ошибочно' }

export class NpdError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Ключ доступа, полученный входом по SMS. */
interface AccessKey {
  refreshToken: string
  /** id «устройства», к которому ФНС привязала ключ. */
  deviceId: string
  inn: string
  phone: string
  connectedAt: string
  /** ФНС перестала принимать ключ (причина): нужно подключить заново. */
  broken?: string
}

interface AuthResponse {
  token?: string
  refreshToken?: string
  tokenExpireIn?: string
  profile?: { inn?: string | number }
}

/** Время в формате «Мой налог»: 2026-10-02T15:04:05+03:00 (московское). */
export const mskTime = (d: Date) => `${new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 19)}+03:00`

/** Название услуги в чеке; номер платежа делает его уникальным (по нему ищем уже выданный чек). */
export const serviceName = (p: Pick<Payment, 'id' | 'planPurchased' | 'periodDays' | 'product' | 'addonAmount'>) =>
  p.product && p.product !== 'plan'
    ? `LYNK: ${productTitle(p)}, заказ ${p.id}`
    : `Подписка LYNK «${p.planPurchased === 'pro' ? 'Премиум' : 'Старт'}» на ${p.periodDays >= 365 ? '12 месяцев' : '1 месяц'}, заказ ${p.id}`

/** Телефон для «Мой налог»: 79001234567. Принимает +7 900 123-45-67, 8 900…, 900…; иначе null. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.length === 10) d = `7${d}`
  if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`
  return /^7\d{10}$/.test(d) ? d : null
}

/** Шифрование ключа доступа в БД: AES-256-GCM, ключ из секрета сервера. */
function sealer(secret: string) {
  const k = crypto.createHash('sha256').update(`lynk-npd:${secret}`).digest()
  return {
    seal(v: unknown): string {
      const iv = crypto.randomBytes(12)
      const c = crypto.createCipheriv('aes-256-gcm', k, iv)
      const data = Buffer.concat([c.update(JSON.stringify(v), 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')
    },
    open<T>(s: string): T {
      const b = Buffer.from(s, 'base64')
      const d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12))
      d.setAuthTag(b.subarray(12, 28))
      return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')) as T
    },
  }
}

const device = (id: string) => ({ sourceType: 'WEB', sourceDeviceId: id, appVersion: '1.0.0', metaDetails: { userAgent: UA } })
/** id «устройства» как у веб-версии: 21 символ, латиница в нижнем регистре и цифры. */
const newDeviceId = () => crypto.randomBytes(16).toString('hex').slice(0, 21)

export function createNpdReceipts(deps: {
  prisma: PrismaClient
  settings: SettingsService
  env: NodeJS.ProcessEnv
  /** Секрет сервера для шифрования ключа доступа (токен бота). */
  secret: string
  /** Сообщение покупателю (ссылка на чек). */
  notifyUser: (tgId: bigint, text: string) => Promise<void>
  /** Сообщение команде (чек не выдался). */
  notifyStaff: (text: string) => Promise<void>
}) {
  const { prisma, settings, env, notifyUser, notifyStaff } = deps
  const api = (env.MOY_NALOG_API_URL || 'https://lknpd.nalog.ru/api/v1').replace(/\/+$/, '')
  // Запрос SMS-кода у ФНС есть только во второй версии API.
  const apiV2 = api.replace(/\/v1$/, '/v2')
  const envInn = (env.MOY_NALOG_INN ?? '').trim()
  const password = env.MOY_NALOG_PASSWORD ?? ''
  const passwordMode = Boolean(envInn && password)
  // Постоянный id «устройства» для входа по паролю: ФНС привязывает к нему токены.
  const passwordDevice = crypto.createHash('sha256').update(`lynk:${envInn}`).digest('hex').slice(0, 21)
  const box = sealer(deps.secret || 'lynk')

  let key: AccessKey | null = null
  let auth: { token: string; refreshToken: string; expiresAt: number; deviceId: string } | null = null
  let loggingIn: Promise<string> | null = null
  const inFlight = new Set<bigint>()

  const keyActive = () => Boolean(key && !key.broken)
  const isOn = () => keyActive() || passwordMode
  const inn = () => (keyActive() ? key!.inn : envInn)

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, token?: string, base = api): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Referer: 'https://lknpd.nalog.ru/',
        'User-Agent': UA,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* не JSON */
    }
    if (!res.ok) {
      const d = (data ?? {}) as { message?: string; code?: string }
      throw new NpdError(res.status, d.message || d.code || text.slice(0, 200) || `HTTP ${res.status}`)
    }
    return data as T
  }

  function saveAuth(data: AuthResponse | null, deviceId: string) {
    if (!data?.token) throw new NpdError(0, '«Мой налог» не выдал токен')
    // tokenExpireIn: дата окончания токена; если её нет, обновляем через 50 минут.
    const exp = data.tokenExpireIn ? Date.parse(data.tokenExpireIn) : NaN
    auth = {
      token: data.token,
      refreshToken: data.refreshToken || (auth?.deviceId === deviceId ? auth.refreshToken : ''),
      expiresAt: Number.isFinite(exp) ? exp - 60_000 : Date.now() + 50 * 60_000,
      deviceId,
    }
    return auth.token
  }

  /** Сохраняет ключ в БД: refresh-токен и id устройства зашифрованы, остальное для экрана в админке. */
  async function storeKey(k: AccessKey) {
    const { refreshToken, deviceId, ...meta } = k
    const value = { ...meta, sealed: box.seal({ refreshToken, deviceId }) }
    await prisma.setting.upsert({ where: { key: KEY_ROW }, create: { key: KEY_ROW, value }, update: { value } })
  }

  /** ФНС не принимает ключ: чеки ждут, пока владелец подключит заново (их выдаст джоба). */
  async function keyBroken(reason: string) {
    if (!key || key.broken) return
    key = { ...key, broken: reason || 'ключ не принят' }
    auth = null
    await storeKey(key).catch((err) => recordError('npd key store', err))
    await notifyStaff(
      `❌ «Мой налог» больше не принимает ключ доступа: ${reason}\n` +
        (passwordMode
          ? 'Пока чеки выдаются по ИНН и паролю. Подключите ключ заново: /admin → Настройки → Чеки «Мой налог».'
          : 'Чеки не выдаются. Подключите заново: /admin → Настройки → Чеки «Мой налог». Чеки за оплаты, прошедшие за это время, выдадутся сами.'),
    ).catch(() => undefined)
  }

  async function login(): Promise<string> {
    if (key && !key.broken) {
      const k = key
      try {
        const data = await request<AuthResponse>('POST', '/auth/token', { deviceInfo: device(k.deviceId), refreshToken: k.refreshToken })
        // Если ФНС выдала новый refresh-токен, старый может перестать работать: сохраняем сразу.
        if (data?.refreshToken && data.refreshToken !== k.refreshToken) {
          key = { ...k, refreshToken: data.refreshToken }
          await storeKey(key)
        }
        return saveAuth(data, k.deviceId)
      } catch (err) {
        // Сеть или ФНС недоступны: ключ ни при чём, повторим позже.
        if (!(err instanceof NpdError && [400, 401, 403].includes(err.status))) throw err
        await keyBroken(err.message)
      }
    }
    if (!passwordMode) {
      throw new NpdError(401, key?.broken ? 'Ключ доступа «Мой налог» не действует, подключите заново' : 'Чеки «Мой налог» не подключены')
    }
    if (auth?.refreshToken && auth.deviceId === passwordDevice) {
      try {
        return saveAuth(await request<AuthResponse>('POST', '/auth/token', { deviceInfo: device(passwordDevice), refreshToken: auth.refreshToken }), passwordDevice)
      } catch {
        auth = null
      }
    }
    return saveAuth(await request<AuthResponse>('POST', '/auth/lkfl', { username: envInn, password, deviceInfo: device(passwordDevice) }), passwordDevice)
  }

  /** Действующий токен; одновременные запросы ждут один вход (иначе два обновления ключа мешали бы друг другу). */
  async function token(): Promise<string> {
    if (auth && Date.now() < auth.expiresAt) return auth.token
    loggingIn ??= login().finally(() => (loggingIn = null))
    return loggingIn
  }

  /** Запрос с токеном; на 401 входим заново и повторяем один раз. */
  async function authed<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    try {
      return await request<T>(method, path, body, await token())
    } catch (err) {
      if (!(err instanceof NpdError && err.status === 401) || !isOn()) throw err
      auth = null
      return request<T>(method, path, body, await token())
    }
  }

  const receiptUrl = (uuid: string) => `${api}/receipt/${inn()}/${uuid}/print`

  async function since(): Promise<Date> {
    const s = await settings.get()
    return s.npdEnabledAt ? new Date(s.npdEnabledAt) : new Date()
  }

  /** Чек по этому платежу уже есть в «Мой налог» (например, ответ ФНС потерялся по таймауту)? */
  async function findExisting(p: Payment): Promise<string | null> {
    const at = p.paidAt ?? p.createdAt
    const q = new URLSearchParams({
      from: mskTime(new Date(at.getTime() - 10 * 60_000)),
      to: mskTime(new Date(at.getTime() + 10 * 60_000)),
      offset: '0',
      limit: '100',
      sortBy: 'operation_time:desc',
    })
    const list = await authed<{ content?: { approvedReceiptUuid?: string; name?: string; services?: { name?: string }[]; cancellationInfo?: unknown }[] }>(
      'GET',
      `/incomes?${q}`,
    )
    const name = serviceName(p)
    const hit = (list?.content ?? []).find((i) => !i.cancellationInfo && (i.name === name || i.services?.some((s) => s.name === name)))
    return hit?.approvedReceiptUuid ?? null
  }

  /**
   * Регистрирует доход по оплаченному платежу и присылает покупателю ссылку на чек.
   * Повторный вызов ничего не делает. force: выдать и по платежу до включения (кнопка в админке).
   */
  async function issue(paymentId: bigint, opts: { force?: boolean } = {}): Promise<string | null> {
    if (!isOn() || inFlight.has(paymentId)) return null
    inFlight.add(paymentId)
    let orderId = String(paymentId)
    try {
      const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { user: true } })
      if (!p || p.status !== 'paid' || p.receiptUuid || !RUB_METHODS.includes(p.method) || Number(p.amountRub) <= 0) return null
      orderId = p.orderId
      if (!opts.force && (p.paidAt ?? p.createdAt) < (await since())) return null
      const amount = Number(p.amountRub)

      // Повтор после сбоя: сначала ищем, не создан ли чек в прошлый раз, чтобы не выдать второй.
      const failedBefore = await prisma.paymentLog.count({ where: { orderId: p.orderId, event: 'npd_failed' } })
      let uuid = failedBefore ? await findExisting(p) : null
      if (!uuid) {
        const data = await authed<{ approvedReceiptUuid?: string }>('POST', '/income', {
          operationTime: mskTime(p.paidAt ?? new Date()),
          requestTime: mskTime(new Date()),
          services: [{ name: serviceName(p), amount, quantity: 1 }],
          totalAmount: amount.toFixed(2),
          client: { contactPhone: null, displayName: null, incomeType: 'FROM_INDIVIDUAL', inn: null },
          paymentType: 'CASH',
          ignoreMaxTotalIncomeRestriction: false,
        })
        uuid = data?.approvedReceiptUuid ?? null
        if (!uuid) throw new NpdError(0, '«Мой налог» не вернул номер чека')
      }
      const url = receiptUrl(uuid)
      await prisma.payment.update({ where: { id: p.id }, data: { receiptUuid: uuid, receiptUrl: url } })
      await prisma.paymentLog.create({ data: { orderId: p.orderId, event: 'npd_receipt', payload: { uuid, url } } })
      await notifyUser(p.user.tgId, `🧾 <b>Чек об оплате</b>\n<a href="${url}">Открыть чек</a> («Мой налог»)`).catch(() => undefined)
      return url
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      recordError('npd receipt', err)
      const failures = await prisma.paymentLog.count({ where: { orderId, event: 'npd_failed' } }).catch(() => 1)
      await prisma.paymentLog.create({ data: { orderId, event: 'npd_failed', payload: { error: message } } }).catch(() => undefined)
      // Команде пишем при первой неудаче и когда автоповторы закончились. Если отвалился ключ
      // доступа, про это уже написал keyBroken, а чек выдастся после переподключения.
      if (isOn()) {
        if (failures === 0) await notifyStaff(`⚠️ Чек «Мой налог» по платежу ${orderId} не выдан: ${message}\nПовторим автоматически.`).catch(() => undefined)
        else if (failures + 1 === MAX_ATTEMPTS)
          await notifyStaff(`❌ Чек «Мой налог» по платежу ${orderId} так и не выдан: ${message}\nВыдайте его кнопкой в карточке платежа или вручную в «Мой налог».`).catch(() => undefined)
      }
      if (opts.force) throw err
      return null
    } finally {
      inFlight.delete(paymentId)
    }
  }

  /** Джоба раз в 10 минут: чеки, которые не выдались сразу (ФНС была недоступна, ключ переподключали). */
  async function retryMissing() {
    if (!isOn()) return 0
    const rows = await prisma.payment.findMany({
      where: {
        status: 'paid',
        receiptUuid: null,
        method: { in: RUB_METHODS },
        amountRub: { gt: 0 },
        paidAt: { gte: await since(), lte: new Date(Date.now() - 2 * 60_000) },
      },
      orderBy: { paidAt: 'asc' },
      take: 20,
    })
    let issued = 0
    for (const p of rows) {
      const failures = await prisma.paymentLog.count({ where: { orderId: p.orderId, event: 'npd_failed' } })
      if (failures >= MAX_ATTEMPTS) continue
      if (await issue(p.id)) issued++
      // Ключ перестал действовать посреди прохода: остальные подождут переподключения.
      if (!isOn()) break
    }
    return issued
  }

  /** Аннулирование чека (возврат денег покупателю или ошибочный чек). */
  async function cancel(paymentId: bigint, reason: CancelReason) {
    if (!isOn()) throw new NpdError(0, 'Чеки «Мой налог» не подключены')
    const p = await prisma.payment.findUnique({ where: { id: paymentId } })
    if (!p?.receiptUuid) throw new NpdError(0, 'У платежа нет чека')
    if (p.receiptCanceledAt) return
    await authed('POST', '/cancel', {
      operationTime: mskTime(new Date()),
      requestTime: mskTime(new Date()),
      comment: CANCEL_COMMENT[reason],
      receiptUuid: p.receiptUuid,
      partnerCode: null,
    })
    await prisma.payment.update({ where: { id: p.id }, data: { receiptCanceledAt: new Date() } })
    await prisma.paymentLog.create({ data: { orderId: p.orderId, event: 'npd_cancel', payload: { reason } } })
  }

  // ── подключение по ключу доступа (SMS) ────────────────────────────────────

  /** Шаг 1: ФНС отправляет SMS с кодом на телефон, привязанный к «Мой налог». */
  async function smsStart(phone: string) {
    const data = await request<{ challengeToken?: string; expireIn?: number }>(
      'POST',
      '/auth/challenge/sms/start',
      { phone, requireTpToBeActive: true },
      undefined,
      apiV2,
    )
    if (!data?.challengeToken) throw new NpdError(0, '«Мой налог» не отправил SMS')
    return { challengeToken: data.challengeToken, expireIn: Number(data.expireIn) || 120 }
  }

  /** Шаг 2: код из SMS → ключ доступа. Пароль не нужен; ключ хранится в БД зашифрованным. */
  async function smsVerify(phone: string, challengeToken: string, code: string) {
    const deviceId = newDeviceId()
    const data = await request<AuthResponse>('POST', '/auth/challenge/sms/verify', { phone, code, challengeToken, deviceInfo: device(deviceId) })
    if (!data?.token || !data.refreshToken) throw new NpdError(0, '«Мой налог» не выдал ключ доступа')
    let userInn = data.profile?.inn ? String(data.profile.inn) : ''
    if (!userInn) userInn = String((await request<{ inn?: string | number }>('GET', '/user', undefined, data.token))?.inn ?? '')
    if (!/^\d{10,12}$/.test(userInn)) throw new NpdError(0, '«Мой налог» не сообщил ИНН')

    // Первое подключение: чеки только по оплатам с этого момента. Переподключение после сбоя
    // ключа или при работающем пароле: оставляем прежнюю дату, пропущенные чеки выдаст джоба.
    const first = !key && !passwordMode
    key = { refreshToken: data.refreshToken, deviceId, inn: userInn, phone, connectedAt: new Date().toISOString() }
    await storeKey(key)
    saveAuth(data, deviceId)
    const s = await settings.get()
    if (first || !s.npdEnabledAt) await settings.set('npdEnabledAt', new Date().toISOString())
    return { inn: userInn }
  }

  /** Отключить ключ доступа (если задан пароль в переменных, чеки продолжат выдаваться по нему). */
  async function disconnect() {
    key = null
    if (auth?.deviceId !== passwordDevice) auth = null
    await prisma.setting.deleteMany({ where: { key: KEY_ROW } })
  }

  /** Для экрана в админке. */
  function status() {
    return {
      mode: keyActive() ? ('key' as const) : passwordMode ? ('password' as const) : null,
      inn: inn() || key?.inn || '',
      phone: key?.phone ?? null,
      connectedAt: key?.connectedAt ? new Date(key.connectedAt) : null,
      broken: key?.broken ?? null,
    }
  }

  /** Читает ключ из БД; при первом запуске с подключением запоминает момент включения. */
  async function init() {
    const row = await prisma.setting.findUnique({ where: { key: KEY_ROW } })
    if (row) {
      const v = row.value as Omit<AccessKey, 'refreshToken' | 'deviceId'> & { sealed?: string }
      const meta = { inn: v.inn, phone: v.phone, connectedAt: v.connectedAt, broken: v.broken }
      try {
        key = { ...meta, ...box.open<{ refreshToken: string; deviceId: string }>(v.sealed ?? '') }
      } catch (err) {
        // Сменился токен бота: ключ не расшифровать, нужно подключить заново.
        recordError('npd key', err)
        key = { ...meta, refreshToken: '', deviceId: '' }
        await keyBroken('ключ не расшифровать (сменился токен бота?)')
      }
    }
    if (!isOn()) return
    const s = await settings.get()
    if (!s.npdEnabledAt) await settings.set('npdEnabledAt', new Date().toISOString())
  }

  const isRubMethod = (m: PaymentMethod) => RUB_METHODS.includes(m)

  return {
    /** Чеки выдаются: ключ доступа действует или заданы ИНН и пароль. */
    get enabled() {
      return isOn()
    },
    init,
    issue,
    retryMissing,
    cancel,
    isRubMethod,
    smsStart,
    smsVerify,
    disconnect,
    status,
  }
}

export type NpdReceipts = ReturnType<typeof createNpdReceipts>
