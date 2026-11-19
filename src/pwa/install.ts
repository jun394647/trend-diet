import { create } from 'zustand'
import { toast } from './toastStore'

/** Chromium이 "설치할 수 있어요"라고 알려 주는 이벤트. 표준 타입에 없어서 직접 적는다. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * 지금 이 기기에서 설치를 어떻게 권할 수 있는지.
 * - prompt: 브라우저 설치 창을 바로 띄울 수 있다(Android, 데스크톱 Chromium).
 * - ios: 설치 이벤트가 없어서 "공유 → 홈 화면에 추가" 방법을 안내한다.
 * - installed: 이미 홈 화면 앱으로 열려 있다. 아무것도 보여 주지 않는다.
 * - none: 설치를 지원하지 않거나 아직 조건이 안 됐다. 아무것도 보여 주지 않는다.
 */
export type InstallMode = 'prompt' | 'ios' | 'installed' | 'none'

const DAYS_KEY = 'trend-diet:usage-days'
const HINT_KEY = 'trend-diet:install-hint'
/** 오늘 화면의 설치 제안은 서로 다른 날 이만큼 쓴 뒤에만 보여 준다. */
export const HINT_MIN_DAYS = 2

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  if (typeof window.matchMedia !== 'function') return false
  return ['standalone', 'fullscreen', 'minimal-ui'].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS는 스스로를 Mac이라고 알리므로 터치 지원 여부로 가려낸다.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** 카카오톡, 네이버, 인스타그램처럼 다른 앱 안에서 열린 화면. 여기서는 홈 화면에 추가할 수 없다. */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent)
}

interface InstallState {
  deferred: BeforeInstallPromptEvent | null
  installed: boolean
  ios: boolean
}

const useInstallState = create<InstallState>(() => ({ deferred: null, installed: false, ios: false }))

let started = false

/**
 * 설치 이벤트를 받아 둘 준비를 한다. 이벤트는 화면이 뜬 직후 한 번만 오므로 되도록 일찍 부른다(main.tsx).
 * 여러 번 불러도 한 번만 동작한다.
 */
export function initInstall(): void {
  if (started || typeof window === 'undefined') return
  started = true
  useInstallState.setState({ installed: isStandalone(), ios: isIos() })
  window.addEventListener('beforeinstallprompt', (e) => {
    // 브라우저가 제멋대로 띄우는 작은 설치 띠 대신, 우리가 고른 자리에서 권한다.
    e.preventDefault()
    useInstallState.setState({ deferred: e as BeforeInstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => {
    useInstallState.setState({ deferred: null, installed: true })
    toast('홈 화면에 설치했어요')
  })
}

/** 테스트용: 받아 둔 상태를 처음으로 되돌린다. */
export function resetInstallForTest(): void {
  useInstallState.setState({ deferred: null, installed: isStandalone(), ios: isIos() })
}

export function useInstallMode(): InstallMode {
  return useInstallState((s) => (s.installed ? 'installed' : s.deferred ? 'prompt' : s.ios ? 'ios' : 'none'))
}

/** 브라우저 설치 창을 띄운다. 설치를 받아들였으면 true. 받아 둔 이벤트는 한 번만 쓸 수 있다. */
export async function promptInstall(): Promise<boolean> {
  const { deferred } = useInstallState.getState()
  if (!deferred) return false
  try {
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    useInstallState.setState({ deferred: null })
    return outcome === 'accepted'
  } catch {
    useInstallState.setState({ deferred: null })
    return false
  }
}

// ── 오늘 화면의 한 번짜리 제안 ───────────────────────────

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function readDays(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DAYS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** 앱을 쓴 날을 적어 둔다. 설치 제안에 필요한 만큼만 남긴다. */
export function recordUsageDay(now: Date = new Date()): void {
  const today = localDay(now)
  const days = readDays()
  if (days.includes(today)) return
  try {
    localStorage.setItem(DAYS_KEY, JSON.stringify([...days, today].slice(-HINT_MIN_DAYS)))
  } catch {
    // 저장소를 못 쓰면 제안이 안 뜰 뿐이다.
  }
}

export function usageDayCount(): number {
  return readDays().length
}

export function isHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== null
  } catch {
    // 기억할 수 없으면 매번 뜨게 되므로 아예 보여 주지 않는다.
    return true
  }
}

export function dismissHint(): void {
  try {
    localStorage.setItem(HINT_KEY, 'dismissed')
  } catch {
    // 위와 같다.
  }
}
