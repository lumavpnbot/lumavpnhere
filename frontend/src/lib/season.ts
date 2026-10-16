import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'

export type Season = 'halloween' | null

/**
 * Сезонное оформление. Пока мероприятие включено в админке, /me отдаёт событие,
 * и приложение одевается в тыквенные цвета: <html data-season="halloween">,
 * дальше всё делают перекрытия в styles/index.css. Событие выключили (или оно
 * закончилось и результаты опубликованы) — атрибут снимается, и возвращается
 * обычное серебро. Отдельного переключателя не нужно: тема временная по своей природе.
 */
export function useSeason(): Season {
  const event = useAppStore((s) => s.halloween)
  const season: Season = event && event.phase !== 'published' ? 'halloween' : null

  useEffect(() => {
    const root = document.documentElement
    if (season) root.dataset.season = season
    else delete root.dataset.season
    return () => {
      delete root.dataset.season
    }
  }, [season])

  return season
}
