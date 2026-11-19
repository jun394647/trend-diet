import { useEffect } from 'react'
import { useSync } from '../sync/store'
import { aiAvailability, refreshAiUsageIfStale, useAi, useAiQuotaLeft, type AiAvailability } from './store'

/** 화면에서 AI 기능을 보여 줄지, 로그인·충돌·횟수 안내를 보여 줄지 정할 때 쓴다. */
export function useAiAvailability(): AiAvailability {
  const configured = useAi((s) => s.configured)
  const forbidden = useAi((s) => s.forbidden)
  const quotaLeft = useAiQuotaLeft()
  const signedIn = useSync((s) => s.email !== null)
  const conflict = useSync((s) => s.conflict !== null)
  // 로그인 상태를 아직 되살리는 중이면 아무것도 보여 주지 않는다. 로그인한 사람에게 '로그인하면…'이 잠깐 뜨지 않게 한다.
  const sessionKnown = useSync((s) => s.ready)
  const usageDate = useAi((s) => s.usageDate)
  // 날이 바뀌었으면 어제 횟수 대신 오늘 횟수를 다시 받아 온다.
  useEffect(() => {
    refreshAiUsageIfStale()
  }, [usageDate])
  if (!sessionKnown) return 'off'
  return aiAvailability(configured, signedIn, { conflict, quotaLeft, forbidden })
}
