import { useMemo } from 'react'
import { buildCoachContext } from '../../ai/context'
import type { CoachContext } from '../../ai/contract'
import { useStore } from '../../store'
import type { DateStr } from '../../types'

/** AI에게 넘길 내 상황 요약. 계획이 아직 없으면 null. */
export function useCoachContext(asOf: DateStr): CoachContext | null {
  const profile = useStore((s) => s.profile)
  const weights = useStore((s) => s.weights)
  const meals = useStore((s) => s.meals)
  const favorites = useStore((s) => s.favorites)
  const checkins = useStore((s) => s.checkins)
  return useMemo(
    () => (profile ? buildCoachContext({ profile, weights, meals, favorites, checkins, asOf }) : null),
    [profile, weights, meals, favorites, checkins, asOf],
  )
}
