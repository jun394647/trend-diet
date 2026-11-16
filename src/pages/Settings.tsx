import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import ProfileForm, {
  draftFromProfile,
  draftToProfileFields,
  validateDraft,
  type ProfileDraft,
} from '../components/ProfileForm'
import { parseDate, today } from '../lib/date'
import { currentPlan } from '../lib/plan'
import { useStore } from '../store'
import type { Profile } from '../types'
import './Settings.css'

type Notice = { kind: 'ok' | 'error'; text: string }

function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return notice.kind === 'error' ? (
    <p className="banner banner--danger st-notice" role="alert">
      {notice.text}
    </p>
  ) : (
    <p className="banner st-notice" role="status">
      {notice.text}
    </p>
  )
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '알 수 없음'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm}`
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'))
    reader.readAsText(file)
  })
}

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 일부 브라우저는 클릭 직후 주소를 지우면 내려받기가 취소된다.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ProfileCard({ profile }: { profile: Profile }) {
  const latestWeightKg = useStore((s) =>
    s.weights.length > 0 ? s.weights[s.weights.length - 1].kg : null,
  )
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile))
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const currentWeightKg = latestWeightKg ?? profile.startWeightKg
  const date = today()
  const errors = useMemo(
    () => validateDraft(draft, { year: parseDate(date).getFullYear(), currentWeightKg }),
    [draft, date, currentWeightKg],
  )

  const save = async () => {
    setNotice(null)
    if (Object.keys(errors).length > 0) {
      setAttempted(true)
      return
    }
    setSaving(true)
    try {
      await useStore.getState().updateProfile({ ...profile, ...draftToProfileFields(draft) })
      const plan = currentPlan(useStore.getState().checkins)
      setNotice({
        kind: 'ok',
        text: plan
          ? `저장했어요. 하루 목표 칼로리는 ${plan.targetKcal.toLocaleString('ko-KR')}kcal예요.`
          : '저장했어요.',
      })
      setAttempted(false)
    } catch {
      setNotice({ kind: 'error', text: '저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card stack" aria-labelledby="st-profile-title">
      <h2 className="card-title st-card-title" id="st-profile-title">
        내 정보
      </h2>
      <ProfileForm
        draft={draft}
        onChange={(patch) => {
          setDraft((d) => ({ ...d, ...patch }))
          setNotice(null)
        }}
        errors={errors}
        showAllErrors={attempted}
        hideWeight
        idPrefix="st"
      />
      <p className="muted small">
        시작 체중은 {profile.startWeightKg}kg이에요. 체중은 오늘 화면에서 기록해요.
      </p>
      <p className="muted small">
        저장하면 지금까지 계산한 소비 칼로리는 그대로 두고 목표 칼로리만 다시 계산해요.
      </p>
      <NoticeBanner notice={notice} />
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={() => void save()}
        disabled={saving}
      >
        {saving ? '저장하는 중…' : '내 정보 저장'}
      </button>
    </section>
  )
}

export default function Settings() {
  const profile = useStore((s) => s.profile)
  const lastBackupAt = useStore((s) => s.lastBackupAt)
  const [backupNotice, setBackupNotice] = useState<Notice | null>(null)
  const [resetNotice, setResetNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  // 가져오기로 프로필이 바뀌면 입력 폼을 새 값으로 다시 만든다.
  const [profileVersion, setProfileVersion] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    setBackupNotice(null)
    setBusy(true)
    try {
      const text = await useStore.getState().exportBackup()
      downloadText(text, `trend-diet-backup-${today()}.json`)
      setBackupNotice({
        kind: 'ok',
        text: '백업 파일을 만들었어요. 내려받은 파일을 안전한 곳에 보관해 주세요.',
      })
    } catch {
      setBackupNotice({ kind: 'error', text: '백업 파일을 만들지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  const handleFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const input = ev.target
    const file = input.files?.[0]
    if (!file) return
    setBackupNotice(null)
    setBusy(true)
    try {
      const text = await readFileText(file)
      const ok = window.confirm(
        '지금 이 기기에 있는 기록을 모두 지우고 백업 파일의 내용으로 바꿔요. 계속할까요?',
      )
      if (!ok) return
      await useStore.getState().importBackup(text)
      setProfileVersion((v) => v + 1)
      setBackupNotice({ kind: 'ok', text: '백업 파일에서 기록을 가져왔어요.' })
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : '알 수 없는 오류'
      setBackupNotice({ kind: 'error', text: `가져오지 못했어요. 기존 기록은 그대로예요. (${message})` })
    } finally {
      // 같은 파일을 다시 고를 수 있게 비운다.
      input.value = ''
      setBusy(false)
    }
  }

  const handleReset = async () => {
    const ok = window.confirm(
      '체중, 식사 기록과 내 정보를 모두 삭제해요. 삭제하면 되돌릴 수 없으니 먼저 백업 파일을 내보내는 것을 권해요. 정말 삭제할까요?',
    )
    if (!ok) return
    setResetNotice(null)
    setBusy(true)
    try {
      await useStore.getState().resetAll()
      // 삭제되면 App이 처음 설정 화면으로 바꾼다.
    } catch {
      setResetNotice({ kind: 'error', text: '삭제하지 못했어요. 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page st">
      <h1 className="page-title">설정</h1>

      {profile && <ProfileCard key={profileVersion} profile={profile} />}

      <section className="card stack" aria-labelledby="st-backup-title">
        <h2 className="card-title st-card-title" id="st-backup-title">
          백업
        </h2>
        <p className="small">
          기록은 이 기기에만 있어서 브라우저 데이터를 지우거나 기기를 바꾸면 사라져요. 가끔 백업
          파일로 내보내 두세요.
        </p>
        <p className="muted small" data-testid="last-backup">
          {lastBackupAt ? `마지막 백업: ${formatDateTime(lastBackupAt)}` : '아직 백업한 적이 없어요.'}
        </p>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => void handleExport()}
          disabled={busy}
        >
          백업 파일 내보내기
        </button>
        <button
          type="button"
          className="btn btn--block"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          백업 파일 가져오기
        </button>
        <input
          ref={fileRef}
          className="st-file"
          type="file"
          accept=".json,application/json"
          aria-label="가져올 백업 파일 선택"
          tabIndex={-1}
          onChange={(ev) => void handleFile(ev)}
        />
        <p className="muted small">가져오면 지금 있는 기록은 백업 파일의 내용으로 바뀌어요.</p>
        <NoticeBanner notice={backupNotice} />
      </section>

      <section className="card stack" aria-labelledby="st-reset-title">
        <h2 className="card-title st-card-title" id="st-reset-title">
          초기화
        </h2>
        <p className="small">
          체중, 식사 기록과 내 정보를 모두 지우고 처음 상태로 돌아가요. 삭제한 뒤에는 되돌릴 수
          없어요.
        </p>
        <NoticeBanner notice={resetNotice} />
        <button
          type="button"
          className="btn btn--danger btn--block"
          onClick={() => void handleReset()}
          disabled={busy}
        >
          모든 데이터 삭제
        </button>
      </section>

      <section className="card stack" aria-labelledby="st-about-title">
        <h2 className="card-title st-card-title" id="st-about-title">
          앱 정보
        </h2>
        <ul className="st-notes small">
          <li>기록은 이 기기의 이 브라우저에만 저장돼요. 서버로 보내지 않고, 다른 기기와 자동으로 맞춰지지도 않아요.</li>
          <li>
            홈 화면에 추가하면 앱처럼 쓸 수 있어요.
            <ul>
              <li>iPhone: Safari에서 공유 → 홈 화면에 추가</li>
              <li>Android: Chrome에서 메뉴 → 앱 설치</li>
            </ul>
          </li>
          <li>소비 칼로리와 목표 칼로리는 기록으로 계산한 추정치이며 의학적 조언이 아니에요. 건강에 걱정되는 점이 있으면 전문가와 상담해 주세요.</li>
        </ul>
      </section>
    </main>
  )
}
