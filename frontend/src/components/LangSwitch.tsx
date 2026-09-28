import { useState } from 'react'
import { useLang, useT, type Lang } from '@/i18n'
import { haptic } from '@/lib/telegram'
import { useAppStore } from '@/store/useAppStore'
import Flag from './Flag'
import Sheet from './Sheet'
import { CheckIcon, ChevronDown } from './icons'

const OPTIONS: { lang: Lang; flag: 'ru' | 'gb'; code: string }[] = [
  { lang: 'ru', flag: 'ru', code: 'RU' },
  { lang: 'en', flag: 'gb', code: 'EN' },
]

/** Кнопка языка: флаг + код; по тапу шторка с выбором. */
export function LangButton() {
  const [open, setOpen] = useState(false)
  const lang = useLang()
  const current = OPTIONS.find((o) => o.lang === lang) ?? OPTIONS[0]

  return (
    <>
      <button
        onClick={() => {
          haptic('light')
          setOpen(true)
        }}
        className="btn-glass !h-9 !gap-1.5 !pl-1.5 !pr-2.5 !text-[13px]"
        aria-label="language"
      >
        <Flag code={current.flag} size={24} />
        {current.code}
        <ChevronDown className="h-3.5 w-3.5 text-dim" />
      </button>
      <LangSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function LangSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const setLang = useAppStore((s) => s.setLang)

  return (
    <Sheet open={open} onClose={onClose} title={t('lang.title')}>
      <div className="space-y-2">
        {OPTIONS.map((o) => {
          const active = o.lang === lang
          return (
            <button
              key={o.lang}
              onClick={() => {
                haptic('select')
                setLang(o.lang)
                setTimeout(onClose, 160)
              }}
              className={`press relative flex w-full items-center gap-4 rounded-[20px] px-4 py-3.5 text-left ${
                active ? 'bg-white/[0.12]' : 'bg-white/[0.04]'
              }`}
            >
              <Flag code={o.flag} size={36} />
              <span className="flex-1">
                <span className="block text-[16px] font-semibold">{t(o.lang === 'ru' ? 'lang.ru' : 'lang.en')}</span>
                <span className="block text-[13px] text-faint">{o.code}</span>
              </span>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                  active ? 'bg-white text-[#0b0b0d]' : 'bg-white/[0.08]'
                }`}
              >
                {active && <CheckIcon className="h-4 w-4" strokeWidth={2.4} />}
              </span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
