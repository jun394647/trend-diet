import { useEffect } from 'react'
import { dismissToast, useToasts } from '../pwa/toastStore'
import type { ToastItem } from '../pwa/toastStore'

function ToastView({ item }: { item: ToastItem }) {
  // 정해진 시간이 지나면 스스로 사라진다.
  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(item.id), item.duration)
    return () => window.clearTimeout(timer)
  }, [item.id, item.duration])

  const { action } = item
  return (
    <div className="toast">
      <span>{item.message}</span>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick()
            dismissToast(item.id)
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/**
 * 알림이 뜨는 자리. 앱에 하나만 둔다(App.tsx).
 * 알림을 띄우려면 `toast('문구')`를 부른다: `import { toast } from '../pwa/toastStore'`
 * 화면 낭독기가 새 문구를 읽을 수 있도록, 알림이 없을 때도 영역은 그대로 둔다.
 */
export default function ToastRegion() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} item={t} />
      ))}
    </div>
  )
}
