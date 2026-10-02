import { recordError } from '@/lib/errors'
import { SBP_BANKS_SNAPSHOT } from './sbpBanksSnapshot'

/** Банк СБП для выбора в Mini App. */
export interface SbpBank {
  /** Схема приложения банка: bank100000000111 (Сбер). */
  schema: string
  name: string
  logo: string
  /** Android-пакет приложения (для intent://). */
  package: string
  /** Банк поддерживает переход сразу в своё приложение; иначе открываем страницу СБП (qr.nspk.ru). */
  direct: boolean
}

const SOURCE = 'https://qr.nspk.ru/proxyapp/c2bmembers.json'
const DAY = 24 * 60 * 60 * 1000

/** Популярные банки наверху списка, в этом порядке (id из схемы). */
const POPULAR = [
  '100000000111', // Сбербанк
  '100000000004', // Т-Банк
  '110000000005', // ВТБ
  '100000000008', // Альфа-Банк
  '100000000273', // Озон Банк
  '100000000150', // Яндекс
  '100000000001', // Газпромбанк
  '100000000007', // Райффайзен
  '100000000013', // Совкомбанк
  '100000000017', // МТС-Банк
  '100000000010', // ПСБ
  '100000000006', // Ак Барс
]

const SCHEMA = /^bank\d{12}$/
const PACKAGE = /^[A-Za-z][A-Za-z0-9_.]{0,100}$/

function sorted(list: SbpBank[]): SbpBank[] {
  const rank = (b: SbpBank) => {
    const i = POPULAR.indexOf(b.schema.slice(4))
    return i < 0 ? POPULAR.length : i
  }
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru'))
}

const fromSnapshot = () =>
  sorted(
    SBP_BANKS_SNAPSHOT.map(([name, id, pkg, logoId, direct]) => ({
      schema: `bank${id}`,
      name,
      logo: logoId ? `https://qr.nspk.ru/proxyapp/logo/bank${logoId}.png` : '',
      package: pkg,
      direct: direct === 1,
    })),
  )

/**
 * Справочник банков СБП: свежий список у НСПК (раз в сутки), если НСПК недоступен,
 * снимок из sbpBanksSnapshot.ts. Ссылки в приложения банков строятся по полю schema.
 */
export function createSbpBanks() {
  let cache: { at: number; list: SbpBank[] } = { at: 0, list: fromSnapshot() }
  let loading: Promise<void> | null = null

  async function refresh() {
    try {
      const res = await fetch(SOURCE, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`НСПК ответил ${res.status}`)
      const raw = (await res.json()) as {
        dictionary?: { bankName?: string; logoURL?: string; schema?: string; package_name?: string; isDrActive?: boolean | string }[]
      }
      const list = (raw.dictionary ?? []).flatMap((b) =>
        b.bankName && b.schema && SCHEMA.test(b.schema)
          ? [{
              schema: b.schema,
              name: b.bankName.trim(),
              logo: b.logoURL?.startsWith('https://') ? b.logoURL : '',
              package: b.package_name && PACKAGE.test(b.package_name) ? b.package_name : '',
              direct: b.isDrActive === true || b.isDrActive === 'true',
            }]
          : [],
      )
      // Пустой или подозрительно короткий ответ не заменяет нормальный список.
      if (list.length >= 20) cache = { at: Date.now(), list: sorted(list) }
      else cache = { ...cache, at: Date.now() - DAY + 60 * 60 * 1000 }
    } catch (err) {
      recordError('sbp banks', err)
      // Повторим через час, пока отдаём то, что есть.
      cache = { ...cache, at: Date.now() - DAY + 60 * 60 * 1000 }
    }
  }

  return {
    async list(): Promise<SbpBank[]> {
      if (Date.now() - cache.at > DAY) {
        loading ??= refresh().finally(() => (loading = null))
        // Первый запрос ждёт НСПК не дольше 2 секунд, дальше отдаём снимок.
        await Promise.race([loading, new Promise((r) => setTimeout(r, 2000))])
      }
      return cache.list
    },
  }
}

export type SbpBanks = ReturnType<typeof createSbpBanks>

/** Платёжная ссылка СБП от провайдера: https://qr.nspk.ru/<id>?<параметры>. */
export const NSPK_LINK = /^https:\/\/qr\.nspk\.ru\/[A-Za-z0-9]{10,64}(\?[A-Za-z0-9=&%._~+-]{0,600})?$/

/**
 * Ссылки в приложение банка для платёжной ссылки СБП (так же делает виджет НСПК):
 * iOS: bank100000000111://qr.nspk.ru/AD10…?…, Android: intent:// с этой схемой и пакетом банка.
 */
export function bankDeeplinks(link: string, schema: string, pkg = '') {
  const rest = link.replace(/^https:\/\//, '')
  return {
    ios: `${schema}://${rest}`,
    android: `intent://${rest}#Intent;scheme=${schema};${PACKAGE.test(pkg) ? `package=${pkg};` : ''}end`,
  }
}

export const isBankSchema = (v: string) => SCHEMA.test(v)
export const isBankPackage = (v: string) => v === '' || PACKAGE.test(v)
