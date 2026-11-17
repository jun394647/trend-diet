import { useState, type FormEvent } from 'react'
import { useSync } from '../sync/store'
import './AccountPanel.css'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '알 수 없음'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 기기와 계정 양쪽에 기록이 있을 때 어느 쪽을 쓸지 고르는 화면. */
function ConflictChoice() {
  const conflict = useSync((s) => s.conflict)
  const resolveConflict = useSync((s) => s.resolveConflict)
  const signOut = useSync((s) => s.signOut)
  const [busy, setBusy] = useState(false)
  if (!conflict) return null

  const choose = (choice: 'remote' | 'merge') => {
    setBusy(true)
    void resolveConflict(choice).finally(() => setBusy(false))
  }

  return (
    <div className="stack" role="group" aria-label="기록 합치는 방법 고르기">
      <p>
        이 기기에 기록 <b className="num">{conflict.localCount.toLocaleString('ko-KR')}</b>건, 계정에
        기록 <b className="num">{conflict.remoteCount.toLocaleString('ko-KR')}</b>건이 있어요. 어떻게
        할까요?
      </p>
      <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={() => choose('remote')}>
        계정 기록 불러오기
      </button>
      <p className="small muted">이 기기의 기록은 지워지고 계정에 저장된 기록으로 바뀌어요.</p>
      <button type="button" className="btn btn--block" disabled={busy} onClick={() => choose('merge')}>
        두 기록 합치기
      </button>
      <p className="small muted">같은 날짜의 체중처럼 겹치는 기록은 이 기기 쪽이 남아요.</p>
      <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={() => void signOut()}>
        취소하고 로그아웃
      </button>
    </div>
  )
}

function AuthForm() {
  const signIn = useSync((s) => s.signIn)
  const signUp = useSync((s) => s.signUp)
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    const addr = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(addr)) return setError('이메일 주소를 다시 확인해 주세요.')
    if (password.length < 6) return setError('비밀번호는 6자 이상으로 적어 주세요.')
    setBusy(true)
    try {
      if (mode === 'in') {
        await signIn(addr, password)
      } else if ((await signUp(addr, password)) === 'confirm') {
        setInfo('확인 메일을 보냈어요. 메일의 링크를 누른 뒤 여기서 로그인해 주세요.')
        setMode('in')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청을 처리하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="segmented" role="group" aria-label="로그인 또는 가입">
        <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>
          로그인
        </button>
        <button type="button" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>
          새로 가입
        </button>
      </div>
      <div className="field">
        <label htmlFor="acc-email">이메일</label>
        <input
          id="acc-email"
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="acc-password">비밀번호</label>
        <input
          id="acc-password"
          className="input"
          type="password"
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === 'up' && <p className="small muted">6자 이상으로 정해 주세요.</p>}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {info && (
        <p className="banner" role="status">
          {info}
        </p>
      )}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
        {busy ? '처리하는 중…' : mode === 'in' ? '로그인' : '가입하고 시작하기'}
      </button>
    </form>
  )
}

/** 로그인 폼, 또는 로그인 뒤 기록 충돌 선택. 온보딩과 설정에서 함께 쓴다. */
export function AccountAuth() {
  const conflict = useSync((s) => s.conflict)
  return conflict ? <ConflictChoice /> : <AuthForm />
}

/** 설정 화면의 계정 카드. 서버 설정이 없는 빌드에서는 아무것도 그리지 않는다. */
export default function AccountPanel() {
  const enabled = useSync((s) => s.enabled)
  const ready = useSync((s) => s.ready)
  const email = useSync((s) => s.email)
  const conflict = useSync((s) => s.conflict)
  const status = useSync((s) => s.status)
  const error = useSync((s) => s.error)
  const lastSyncedAt = useSync((s) => s.lastSyncedAt)
  const syncNow = useSync((s) => s.syncNow)
  const signOut = useSync((s) => s.signOut)

  if (!enabled) return null

  return (
    <section className="card" aria-labelledby="acc-title">
      <h2 className="card-title" id="acc-title">
        계정과 동기화
      </h2>
      {!ready ? (
        <p className="muted">로그인 상태를 확인하는 중이에요…</p>
      ) : email && !conflict ? (
        <div className="stack">
          <div>
            <p className="acc-email">{email}</p>
            <p className="small muted" role="status">
              {status === 'syncing'
                ? '동기화하는 중이에요…'
                : lastSyncedAt
                  ? `마지막 동기화 ${formatDateTime(lastSyncedAt)}`
                  : '아직 동기화하지 않았어요.'}
            </p>
          </div>
          {status === 'error' && error && (
            <p className="banner banner--warn" role="alert">
              동기화하지 못했어요. 기록은 이 기기에 남아 있고, 연결되면 다시 올려요. {error}
            </p>
          )}
          <p className="small muted">
            기록을 계정에 저장해서, 다른 기기에서 로그인해도 같은 기록이 보여요.
          </p>
          <div className="acc-actions">
            <button type="button" className="btn" disabled={status === 'syncing'} onClick={() => void syncNow()}>
              지금 동기화
            </button>
            <button type="button" className="btn" onClick={() => void signOut()}>
              로그아웃
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          {!conflict && (
            <p className="muted">
              로그인하면 기록이 계정에 저장돼요. 휴대폰을 바꾸거나 브라우저 데이터를 지워도 다시
              불러올 수 있어요.
            </p>
          )}
          <AccountAuth />
        </div>
      )}
    </section>
  )
}
