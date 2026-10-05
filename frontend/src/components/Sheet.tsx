import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, m, type PanInfo } from 'framer-motion'
import { haptic } from '@/lib/telegram'

// Кривая как у шторок iOS: быстрый старт и долгое мягкое торможение, без «пружинного» дёрганья.
const EASE = [0.32, 0.72, 0, 1] as const

/**
 * Нижняя шторка: фон затемняется, шторка выезжает снизу, закрывается
 * тапом по фону или свайпом вниз. Анимируются только opacity и transform.
 *
 * Плавность: у шторки нет backdrop-filter (размытие под движущимся слоем
 * пересчитывается каждый кадр и на iPhone рвёт анимацию), фон сплошной.
 * Поле с data-autofocus получает фокус после того, как шторка доехала:
 * клавиатура, открывшаяся посреди анимации, сдвигала экран рывком.
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const panel = useRef<HTMLDivElement | null>(null)

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 500) onClose()
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <m.button
            aria-label="close"
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            onClick={() => {
              haptic('light')
              onClose()
            }}
          />
          <m.div
            ref={panel}
            role="dialog"
            className="sheet-panel absolute inset-x-0 bottom-0 mx-auto max-h-[92vh] max-w-[560px] overflow-y-auto overscroll-contain rounded-t-[28px] px-5 pt-3"
            style={{ paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: { duration: 0.42, ease: EASE } }}
            exit={{ y: '100%', transition: { duration: 0.28, ease: EASE } }}
            onAnimationComplete={(def) => {
              // Доехала до места (не уезжает): теперь можно открыть клавиатуру.
              if (typeof def === 'object' && def && 'y' in def && (def as { y: unknown }).y === 0) {
                panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
              }
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragTransition={{ bounceStiffness: 500, bounceDamping: 45 }}
            onDragEnd={onDragEnd}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/25" />
            {title && <h3 className="mb-4 text-[19px] font-semibold">{title}</h3>}
            {children}
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
