import { useEffect, useRef, useState } from 'react'

/** 숫자를 굴려도 되는 환경인지. 움직임을 줄이라고 한 기기와 matchMedia가 없는 환경에서는 굴리지 않는다. */
function canAnimate(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    typeof window.requestAnimationFrame === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 값이 바뀌면 이전 값에서 새 값까지 짧게 굴러가는 숫자를 돌려준다.
 * 처음 그릴 때는 굴리지 않고 바로 보여 준다(내용이 도착할 때 숫자가 흔들리지 않게).
 */
export function useCountUp(value: number, ms = 340): number {
  const [shown, setShown] = useState(value)
  const current = useRef(value)
  const animate = canAnimate()

  useEffect(() => {
    const start = current.current
    if (!animate || start === value) {
      current.current = value
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      const v = start + (value - start) * (1 - Math.pow(1 - p, 3))
      current.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms, animate])

  return animate ? shown : value
}
