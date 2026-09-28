import { haptic } from '@/lib/telegram'
import { MinusIcon, PlusIcon } from './icons'

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic('select')
        onChange(!checked)
      }}
      className={`relative h-[30px] w-[52px] shrink-0 rounded-pill transition-colors duration-300 ${
        checked ? 'bg-white/90' : 'bg-white/[0.12]'
      }`}
    >
      <span
        className={`absolute left-[3px] top-[3px] h-6 w-6 rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-[transform,background-color] duration-300 ${
          checked ? 'translate-x-[22px] bg-[#0b0b0d]' : 'translate-x-0 bg-white/80'
        }`}
        style={{ transitionTimingFunction: 'var(--ease)' }}
      />
    </button>
  )
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const change = (d: number) => {
    const next = Math.min(max, Math.max(min, value + d))
    if (next === value) return
    haptic('select')
    onChange(next)
  }
  return (
    <div className="inline-flex h-10 items-center rounded-pill bg-white/[0.07] p-1">
      <button onClick={() => change(-step)} disabled={value <= min} className="press flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-30">
        <MinusIcon className="h-4 w-4" />
      </button>
      <span className="min-w-[52px] text-center text-[15px] font-semibold tabular-nums">
        {value}
        {suffix}
      </span>
      <button onClick={() => change(step)} disabled={value >= max} className="press flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-30">
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  )
}
