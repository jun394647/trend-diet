import { create } from 'zustand'
import { today } from '../lib/date'
import { useSync } from '../sync/store'
import { fetchAiStatus } from './client'
import type { AiUsage } from './contract'

export interface AiState {
  /** 서버에 API 키가 들어 있어 AI 기능을 쓸 수 있는지. 확인 전에는 false. */
  configured: boolean
  checked: boolean
  /** 마지막 호출에서 서버가 알려 준 오늘 사용량. */
  usage: AiUsage | null
  /** usage를 받은 날. 날이 바뀌면 그 사용량은 더 이상 믿지 않는다. */
  usageDate: string | null
  /** 서버가 이 계정은 AI 기능을 쓸 수 없다고 답했다. 계정이 바뀌면 다시 false가 된다. */
  forbidden: boolean
  /** 서버 상태를 확인한다. 이미 확인했으면 다시 하지 않는다. force를 주면 오늘 쓴 횟수를 다시 받아 온다. */
  check: (force?: boolean) => Promise<void>
  setUsage: (usage: AiUsage) => void
  setForbidden: (forbidden?: boolean) => void
}

/** 가장 마지막에 시작한 확인만 사용량을 쓴다. */
let checkSeq = 0
/** 지금 진행 중인 확인의 수. */
let checking = 0
const isStale = (usageDate: string | null) => usageDate !== null && usageDate !== today()

export const useAi = create<AiState>((set, get) => ({
  configured: false,
  checked: false,
  usage: null,
  usageDate: null,
  forbidden: false,
  check: async (force = false) => {
    if (get().checked && !force) return
    const mine = ++checkSeq
    // 사용량은 계정마다 다르다. 기다리는 사이에 계정이 바뀌면 받은 횟수는 쓰지 않는다.
    const email = useSync.getState().email
    checking++
    let status: Awaited<ReturnType<typeof fetchAiStatus>>
    try {
      status = await fetchAiStatus()
    } finally {
      checking--
    }
    // 다시 확인할 때는 횟수만 고친다. 확인에 실패했다고 쓰던 기능을 끄지는 않는다.
    if (!force || status.configured === true) set({ configured: status.configured === true, checked: true })
    if (mine !== checkSeq || useSync.getState().email !== email) return
    if (typeof status.used === 'number' && status.dailyLimit > 0) {
      set({ usage: { used: status.used, limit: status.dailyLimit }, usageDate: today() })
    } else if (isStale(get().usageDate)) {
      set({ usage: null, usageDate: null })
    }
  },
  setUsage: (usage) => set({ usage, usageDate: today() }),
  setForbidden: (forbidden = true) => set({ forbidden }),
}))

// 사용량과 사용 가능 여부는 계정마다 다르다. 로그인·로그아웃하거나 계정이 바뀌면 언제나 지우고,
// 로그인한 계정이 있으면 그 계정이 오늘 쓴 횟수를 다시 받아 온다.
useSync.subscribe((s, prev) => {
  if (s.email === prev.email) return
  useAi.setState({ usage: null, usageDate: null, forbidden: false })
  // 앱이 아직 한 번도 확인하지 않았다면 첫 확인이 곧 온다. 그때 받아 온다.
  if (s.email !== null && (useAi.getState().checked || checking > 0)) void useAi.getState().check(true)
})

/** 알고 있는 사용량이 어제 것이면 다시 받아 온다. 화면이 AI 상태를 읽을 때 부른다. */
export function refreshAiUsageIfStale(): void {
  if (isStale(useAi.getState().usageDate) && checking === 0) void useAi.getState().check(true)
}

/** 오늘 남은 AI 횟수. 아직 한 번도 부르지 않아 모르면 null. */
export function quotaLeft(usage: AiUsage | null | undefined): number | null {
  return usage ? Math.max(0, usage.limit - usage.used) : null
}

/** 오늘 남은 AI 횟수. 모르거나, 알던 값이 어제 것이면 null. */
export function useAiQuotaLeft(): number | null {
  return useAi((s) => (s.usageDate !== null && s.usageDate !== today() ? null : quotaLeft(s.usage)))
}

/**
 * 지금 AI 기능을 쓸 수 있는 상태인지.
 *  - 'off': 서버에 준비되지 않았거나 이 계정은 쓸 수 없다. AI 관련 화면 요소를 아예 숨긴다.
 *  - 'conflict': 로그인했지만 기록을 어떻게 합칠지 정하지 않았다. 정하면 쓸 수 있다고 안내한다.
 *  - 'login': 준비는 됐지만 로그인하지 않았다. 로그인하면 쓸 수 있다고 안내한다.
 *  - 'limit': 오늘 횟수를 다 썼다. AI 버튼을 숨기고 내일 다시 쓸 수 있다고 안내한다.
 *  - 'ready': 쓸 수 있다.
 */
export type AiAvailability = 'off' | 'conflict' | 'login' | 'limit' | 'ready'

export interface AiAvailabilityExtra {
  /** 동기화 충돌이 사용자의 선택을 기다리는 중인지. */
  conflict?: boolean
  /** 오늘 남은 횟수. 모르면 null. */
  quotaLeft?: number | null
  forbidden?: boolean
}

/** 판단 순서: off → conflict → login → limit → ready. 세 번째 인자를 주지 않으면 예전처럼 off/login/ready만 돌려준다. */
export function aiAvailability(configured: boolean, signedIn: boolean, extra: AiAvailabilityExtra = {}): AiAvailability {
  if (!configured || extra.forbidden) return 'off'
  if (signedIn && extra.conflict) return 'conflict'
  if (!signedIn) return 'login'
  if (extra.quotaLeft === 0) return 'limit'
  return 'ready'
}
