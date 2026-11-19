import { create } from 'zustand'

/** 알림 안에 넣는 버튼 하나. 예: { label: '되돌리기', onClick: undo } */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  action?: ToastAction
  /** 떠 있는 시간(ms). 기본은 4초, 버튼이 있으면 7초. */
  duration?: number
}

export interface ToastItem {
  id: number
  message: string
  action?: ToastAction
  duration: number
}

/** 한 번에 보여 주는 알림 수. 더 오면 가장 오래된 것부터 내린다. */
export const MAX_TOASTS = 2

interface ToastState {
  toasts: ToastItem[]
}

export const useToasts = create<ToastState>(() => ({ toasts: [] }))

let nextId = 1

/**
 * 화면 아래에 잠깐 뜨는 알림을 띄운다. 컴포넌트 밖에서도 부를 수 있다.
 * 같은 문구가 이미 떠 있으면 새로 쌓지 않고 그 자리에서 다시 띄운다.
 */
export function toast(message: string, options: ToastOptions = {}): number {
  const id = nextId++
  const duration = options.duration ?? (options.action ? 7000 : 4000)
  useToasts.setState((s) => ({
    toasts: [...s.toasts.filter((t) => t.message !== message), { id, message, action: options.action, duration }].slice(
      -MAX_TOASTS,
    ),
  }))
  return id
}

export function dismissToast(id: number): void {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}
