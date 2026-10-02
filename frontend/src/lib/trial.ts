import { useLang } from '@/i18n'
import { daysWord } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

/** Длительность пробного периода для текстов: «3 дня», «4 дня» (с сервера, меняется в админке). */
export function useTrialVars() {
  const lang = useLang()
  const { days, referralDays } = useAppStore((s) => s.trial)
  const fmt = (n: number) => `${n} ${daysWord(lang, n)}`
  return { trial: fmt(days), trialN: days, trialRef: fmt(referralDays), bonus: fmt(Math.max(0, referralDays - days)) }
}
