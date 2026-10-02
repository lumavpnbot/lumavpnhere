import crypto from 'node:crypto'
import type { Payment, PaymentMethod, PrismaClient } from '@prisma/client'
import { recordError } from '@/lib/errors'
import type { SettingsService } from './settings'

/**
 * Чеки самозанятого в «Мой налог» (НПД). ЮKassa с 29.12.2025 больше не отправляет их сама,
 * поэтому после каждой оплаты рублями регистрируем доход сами через API личного кабинета
 * lknpd.nalog.ru (тот же, что у веб-версии «Мой налог»; официального публичного API у ФНС нет,
 * формат сверен с библиотекой shoman4eg/moy-nalog).
 *
 * Переменные: MOY_NALOG_INN и MOY_NALOG_PASSWORD (пароль из веб-кабинета «Мой налог»).
 * Чеки выдаются только по оплатам после включения (settings.npdEnabledAt), на сумму,
 * реально полученную от покупателя (без части с внутреннего баланса).
 */

/** Способы, где покупатель платит рублями: по ним самозанятый получает доход и выдаёт чек. */
const RUB_METHODS: PaymentMethod[] = ['platega', 'platega_sbp', 'yookassa_sbp', 'yookassa_card']
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
/** После стольких неудач подряд автоповтор прекращается (чек можно выдать кнопкой в админке). */
const MAX_ATTEMPTS = 5

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

/** Время в формате «Мой налог»: 2026-10-02T15:04:05+03:00 (московское). */
export const mskTime = (d: Date) => `${new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 19)}+03:00`

/** Название услуги в чеке; номер платежа делает его уникальным (по нему ищем уже выданный чек). */
export const serviceName = (p: Pick<Payment, 'id' | 'planPurchased' | 'periodDays'>) =>
  `Подписка LYNK «${p.planPurchased === 'pro' ? 'Премиум' : 'Старт'}» на ${p.periodDays >= 365 ? '12 месяцев' : '1 месяц'}, заказ ${p.id}`

export function createNpdReceipts(deps: {
  prisma: PrismaClient
  settings: SettingsService
  env: NodeJS.ProcessEnv
  /** Сообщение покупателю (ссылка на чек). */
  notifyUser: (tgId: bigint, text: string) => Promise<void>
  /** Сообщение команде (чек не выдался). */
  notifyStaff: (text: string) => Promise<void>
}) {
  const { prisma, settings, env, notifyUser, notifyStaff } = deps
  const api = (env.MOY_NALOG_API_URL || 'https://lknpd.nalog.ru/api/v1').replace(/\/+$/, '')
  const inn = (env.MOY_NALOG_INN ?? '').trim()
  const password = env.MOY_NALOG_PASSWORD ?? ''
  const enabled = Boolean(inn && password)
  // Постоянный id «устройства»: ФНС привязывает к нему токены входа.
  const deviceInfo = {
    sourceType: 'WEB',
    sourceDeviceId: crypto.createHash('sha256').update(`lynk:${inn}`).digest('hex').slice(0, 21),
    appVersion: '1.0.0',
    metaDetails: { userAgent: UA },
  }
  let auth: { token: string; refreshToken: string; expiresAt: number } | null = null
  const inFlight = new Set<bigint>()

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<T> {
    const res = await fetch(`${api}${path}`, {
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

  function saveAuth(data: { token?: string; refreshToken?: string; tokenExpireIn?: string } | null) {
    if (!data?.token) throw new NpdError(0, '«Мой налог» не выдал токен')
    // tokenExpireIn: дата окончания токена; если её нет, обновляем через 50 минут.
    const exp = data.tokenExpireIn ? Date.parse(data.tokenExpireIn) : NaN
    auth = {
      token: data.token,
      refreshToken: data.refreshToken || auth?.refreshToken || '',
      expiresAt: Number.isFinite(exp) ? exp - 60_000 : Date.now() + 50 * 60_000,
    }
    return auth.token
  }

  async function token(): Promise<string> {
    if (auth && Date.now() < auth.expiresAt) return auth.token
    if (auth?.refreshToken) {
      try {
        return saveAuth(await request('POST', '/auth/token', { deviceInfo, refreshToken: auth.refreshToken }))
      } catch {
        auth = null
      }
    }
    return saveAuth(await request('POST', '/auth/lkfl', { username: inn, password, deviceInfo }))
  }

  /** Запрос с токеном; на 401 входим заново и повторяем один раз. */
  async function authed<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    try {
      return await request<T>(method, path, body, await token())
    } catch (err) {
      if (!(err instanceof NpdError && err.status === 401)) throw err
      auth = null
      return request<T>(method, path, body, await token())
    }
  }

  const receiptUrl = (uuid: string) => `${api}/receipt/${inn}/${uuid}/print`

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
    if (!enabled || inFlight.has(paymentId)) return null
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
      // Команде пишем при первой неудаче и когда автоповторы закончились.
      if (failures === 0) await notifyStaff(`⚠️ Чек «Мой налог» по платежу ${orderId} не выдан: ${message}\nПовторим автоматически.`).catch(() => undefined)
      else if (failures + 1 === MAX_ATTEMPTS)
        await notifyStaff(`❌ Чек «Мой налог» по платежу ${orderId} так и не выдан: ${message}\nВыдайте его кнопкой в карточке платежа или вручную в «Мой налог».`).catch(() => undefined)
      if (opts.force) throw err
      return null
    } finally {
      inFlight.delete(paymentId)
    }
  }

  /** Джоба раз в 10 минут: чеки, которые не выдались сразу (ФНС была недоступна). */
  async function retryMissing() {
    if (!enabled) return 0
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
    }
    return issued
  }

  /** Аннулирование чека (возврат денег покупателю или ошибочный чек). */
  async function cancel(paymentId: bigint, reason: CancelReason) {
    if (!enabled) throw new NpdError(0, 'Чеки «Мой налог» не подключены')
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

  /** При первом запуске с ключами запоминаем момент включения: старые оплаты чеков не получают. */
  async function init() {
    if (!enabled) return
    const s = await settings.get()
    if (!s.npdEnabledAt) await settings.set('npdEnabledAt', new Date().toISOString())
  }

  const isRubMethod = (m: PaymentMethod) => RUB_METHODS.includes(m)

  return { enabled, init, issue, retryMissing, cancel, isRubMethod }
}

export type NpdReceipts = ReturnType<typeof createNpdReceipts>
