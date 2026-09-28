import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { haptic, nativeBack } from './telegram'

export const TAB_PATHS = ['/', '/plans', '/devices', '/referrals', '/account']

// Родитель для вложенных экранов: Back ведёт туда, даже если истории нет.
const PARENT: Record<string, string> = {
  '/connect': '/devices',
  '/balance': '/',
  '/account/notifications': '/account',
  '/account/logins': '/account',
}

/**
 * Поведение «Назад» как в elix/CallLedger:
 *  главная: кнопки нет (Telegram показывает Close);
 *  другие вкладки: на главную;
 *  вложенные экраны: на родительский экран.
 */
export function useGoBack() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return useCallback(() => {
    haptic('light')
    navigate(PARENT[pathname] ?? '/', { replace: true })
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
