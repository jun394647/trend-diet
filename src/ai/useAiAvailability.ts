import { useSync } from '../sync/store'
import { aiAvailability, useAi, useAiQuotaLeft, type AiAvailability } from './store'

/** 화면에서 AI 기능을 보여 줄지, 로그인·충돌·횟수 안내를 보여 줄지 정할 때 쓴다. */
export function useAiAvailability(): AiAvailability {
  const configured = useAi((s) => s.configured)
  const forbidden = useAi((s) => s.forbidden)
  const quotaLeft = useAiQuotaLeft()
  const signedIn = useSync((s) => s.email !== null)
  const conflict = useSync((s) => s.conflict !== null)
  return aiAvailability(configured, signedIn, { conflict, quotaLeft, forbidden })
}
