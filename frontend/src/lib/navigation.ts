import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { haptic, nativeBack } from './telegram'

export const TAB_PATHS = ['/', '/plans', '/devices', '/referrals', '/account']

/**
 * Поведение «Назад» как в elix/CallLedger:
 *  - главная → кнопки нет (Telegram показывает Close);
 *  - другие вкладки → на главную;
 *  - вложенные экраны (/connect и т.п.) → на шаг назад.
 */
export function useGoBack() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return useCallback(() => {
    haptic('light')
    if (TAB_PATHS.includes(pathname)) navigate('/', { replace: true })
    else if (window.history.state && window.history.state.idx > 0) navigate(-1)
    else navigate('/', { replace: true })
  }, [navigate, pathname])
}

/** Синхронизирует нативную Telegram BackButton с текущим экраном. */
export function useTelegramBackButton() {
  const { pathname } = useLocation()
  const goBack = useGoBack()

  useEffect(() => {
    if (!nativeBack) return
    if (pathname === '/') {
      nativeBack.hide()
      return
    }
    nativeBack.show()
    nativeBack.onClick(goBack)
    return () => nativeBack?.offClick(goBack)
  }, [pathname, goBack])
}
