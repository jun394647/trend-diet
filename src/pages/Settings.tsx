import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import AccountPanel from '../components/AccountPanel'
import ProfileForm from '../components/ProfileForm'
import {
  draftFromProfile,
  draftToProfileFields,
  phasePatchForPace,
  validateDraft,
  type ProfileDraft,
} from '../components/profileFormModel'
import { formatShort, parseDate, today } from '../lib/date'
import { currentPlan } from '../lib/plan'
import { phaseOf, targetRange, weekOfPhase } from '../lib/sustain'
import { useStore } from '../store'
import { useSync } from '../sync/store'
import type { Phase, Profile } from '../types'
import InstallEntry from '../components/InstallEntry'
import OpenOnLaunchSetting from '../components/OpenOnLaunchSetting'
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

const kcal = (n: number) => n.toLocaleString('ko-KR')

function rangeText(targetKcal: number): string {
  const { low, high } = targetRange(targetKcal)
  return `${kcal(low)}~${kcal(high)}kcal`
}

const rangeNameOf = (phase: Phase) => (phase === 'maintain' ? '하루 유지 범위' : '하루 목표 범위')

/** 지금 단계와 하루 목표 범위를 보여 주고, 감량과 유지 사이를 직접 바꾼다. */
function PhaseSection({ profile, onChanged }: { profile: Profile; onChanged: () => void }) {
  const checkins = useStore((s) => s.checkins)
  const latestWeightKg = useStore((s) =>
    s.weights.length > 0 ? s.weights[s.weights.length - 1].kg : null,
  )
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const plan = useMemo(() => currentPlan(checkins), [checkins])
  const date = today()
  const phase = phaseOf(profile)
  const maintaining = phase === 'maintain'
  const currentWeightKg = latestWeightKg ?? profile.startWeightKg
  const atGoal = currentWeightKg <= profile.goalWeightKg
  const blocked = maintaining && atGoal
  const range = plan ? targetRange(plan.targetKcal) : null

  const change = async () => {
    setSaving(true)
    setNotice(null)
    const next: Profile = maintaining
      ? {
          ...profile,
          phase: 'lose',
          phaseStartedAt: date,
          breakUntil: null,
          weeklyLossKg: profile.weeklyLossKg > 0 ? profile.weeklyLossKg : 0.5,
        }
      : { ...profile, phase: 'maintain', phaseStartedAt: date, breakUntil: null }
    try {
      await useStore.getState().updateProfile(next)
      const after = currentPlan(useStore.getState().checkins)
      const nextPhase = phaseOf(next)
      const done = nextPhase === 'maintain' ? '유지 기간으로 바꿨어요.' : '감량을 다시 시작했어요.'
      setNotice({
        kind: 'ok',
        text: after ? `${done} ${rangeNameOf(nextPhase)}는 ${rangeText(after.targetKcal)}예요.` : done,
      })
      setConfirming(false)
      onChanged()
    } catch {
      setNotice({ kind: 'error', text: '바꾸지 못했어요. 잠시 뒤에 다시 시도해 주세요.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel st-phase" aria-labelledby="st-phase-title">
      <div className="st-phase-head">
        <h2 className="card-title" id="st-phase-title">
          지금 단계
        </h2>
        {maintaining ? (
          <span className="chip chip--good" data-testid="st-phase-chip">
            {profile.breakUntil ? `쉬어 가는 유지 기간 · ${formatShort(profile.breakUntil)}까지` : '유지 중'}
          </span>
        ) : (
          <span className="chip chip--accent" data-testid="st-phase-chip">
            감량 {weekOfPhase(profile, date)}주차
          </span>
        )}
      </div>

      {range && (
        <div className="st-phase-main">
          <p className="st-phase-label">{rangeNameOf(phase)}</p>
          <p className="big-num st-phase-range">
            <span data-testid="st-phase-range">
              {kcal(range.low)}~{kcal(range.high)}
            </span>
            <span className="unit">kcal</span>
          </p>
        </div>
      )}

      <p className="st-phase-desc">
        {maintaining
          ? '쓰는 만큼 먹으면서 지금 체중을 지키는 기간이에요.'
          : `일주일에 ${profile.weeklyLossKg}kg씩 빼는 속도에 맞춘 범위예요.`}
      </p>

      {notice &&
        (notice.kind === 'error' ? (
          <p className="st-phase-notice" role="alert">
            {notice.text}
          </p>
        ) : (
          <p className="st-phase-notice" role="status">
            {notice.text}
          </p>
        ))}

      {confirming ? (
        <div className="st-phase-confirm" role="group" aria-label="단계 바꾸기 확인">
          <p>
            {maintaining
              ? `감량 기간을 오늘부터 다시 세고, 하루 목표 범위를 일주일에 ${
                  profile.weeklyLossKg > 0 ? profile.weeklyLossKg : 0.5
                }kg 빼는 속도에 맞춰 낮춰요.`
              : '하루 목표 범위를 쓰는 만큼 먹는 양으로 올려요. 감량은 여기서 언제든 다시 시작할 수 있어요.'}
          </p>
          <div className="st-confirm-actions">
            <button type="button" className="btn st-phase-btn" onClick={() => setConfirming(false)} disabled={saving}>
              취소
            </button>
            <button
              type="button"
              className="btn st-phase-btn st-phase-btn--solid"
              onClick={() => void change()}
              disabled={saving}
            >
              {saving ? '바꾸는 중…' : maintaining ? '감량 시작하기' : '유지로 바꾸기'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="btn btn--block st-phase-btn"
            onClick={() => {
              setNotice(null)
              setConfirming(true)
            }}
            disabled={blocked}
            aria-describedby={blocked ? 'st-phase-blocked' : undefined}
          >
            {maintaining ? '감량 다시 시작하기' : '유지 기간으로 바꾸기'}
          </button>
          {blocked && (
            <p className="st-phase-hint" id="st-phase-blocked">
              지금 체중({currentWeightKg}kg)이 목표 체중({profile.goalWeightKg}kg)과 같거나 더 낮아서
              감량을 다시 시작할 수 없어요. 더 빼고 싶다면 아래 내 정보에서 목표 체중을 먼저 낮춰
              주세요.
            </p>
          )}
        </>
      )}
    </section>
  )
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
  // 쉬어 가는 동안에는 고른 감량 속도가 목표에 반영되지 않는다.
  const pacePaused = phaseOf(profile) === 'maintain' && draft.weeklyLossKg > 0 && profile.weeklyLossKg > 0

  const save = async () => {
    setNotice(null)
    if (Object.keys(errors).length > 0) {
      setAttempted(true)
      return
    }
    setSaving(true)
    try {
      const fields = draftToProfileFields(draft)
      // 단계는 속도를 유지로 바꾸거나 유지에서 감량 속도로 바꿀 때만 달라진다.
      const next: Profile = { ...profile, ...fields, ...phasePatchForPace(profile, fields.weeklyLossKg, date) }
      await useStore.getState().updateProfile(next)
      const plan = currentPlan(useStore.getState().checkins)
      setNotice({
        kind: 'ok',
        text: plan
          ? `저장했어요. ${rangeNameOf(phaseOf(next))}는 ${rangeText(plan.targetKcal)}예요.`
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
      <h2 className="st-title" id="st-profile-title">
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
      {pacePaused && (
        <p className="muted small st-fine">
          지금은 유지 기간이라, 고른 속도는 감량을 다시 시작할 때부터 적용돼요.
        </p>
      )}
      <p className="muted small st-fine">
        시작 체중은 {profile.startWeightKg}kg이에요. 체중은 오늘 화면에서 기록해요. 저장하면 지금까지
        계산한 소비 칼로리는 그대로 두고 하루 목표 범위만 다시 계산해요.
      </p>
      <NoticeBanner notice={notice} />
      <button
        type="button"
        className="btn btn--primary btn--block btn--lg"
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
  const synced = useSync((s) => s.email !== null && s.conflict === null)
  const [backupNotice, setBackupNotice] = useState<Notice | null>(null)
  const [resetNotice, setResetNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  // 가져오기나 단계 바꾸기로 프로필이 바뀌면 입력 폼을 새 값으로 다시 만든다.
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
        synced
          ? '이 기기와 계정에 있는 기록을 모두 지우고 백업 파일의 내용으로 바꿔요. 계속할까요?'
          : '지금 이 기기에 있는 기록을 모두 지우고 백업 파일의 내용으로 바꿔요. 계속할까요?',
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

      <AccountPanel />

      {profile && <PhaseSection profile={profile} onChanged={() => setProfileVersion((v) => v + 1)} />}

      {profile && <ProfileCard key={profileVersion} profile={profile} />}

      <section className="card stack" aria-labelledby="st-backup-title">
        <h2 className="st-title" id="st-backup-title">
          백업
        </h2>
        <p className="small">
          {synced
            ? '기록은 계정에도 저장되고 있어요. 따로 보관하고 싶을 때 백업 파일로 내보낼 수 있어요.'
            : '기록은 이 기기에만 있어서 브라우저 데이터를 지우거나 기기를 바꾸면 사라져요. 가끔 백업 파일로 내보내 두세요.'}
        </p>
        <p className="muted small st-last-backup" data-testid="last-backup">
          {lastBackupAt ? `마지막 백업: ${formatDateTime(lastBackupAt)}` : '아직 백업한 적이 없어요.'}
        </p>
        <div className="st-actions">
          <button
            type="button"
            className="btn btn--block"
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
          <p className="muted small">가져오면 지금 있는 기록은 백업 파일의 내용으로 바뀌어요.</p>
        </div>
        <input
          ref={fileRef}
          className="st-file"
          type="file"
          accept=".json,application/json"
          aria-label="가져올 백업 파일 선택"
          tabIndex={-1}
          onChange={(ev) => void handleFile(ev)}
        />
        <NoticeBanner notice={backupNotice} />
      </section>

      <section className="card stack" aria-labelledby="st-reset-title">
        <h2 className="st-title" id="st-reset-title">
          초기화
        </h2>
        <p className="small">
          체중, 식사 기록과 내 정보를 모두 지우고 처음 상태로 돌아가요.
          {synced && ' 계정에 저장된 기록도 함께 지워져요.'} 삭제한 뒤에는 되돌릴 수 없어요.
        </p>
        <NoticeBanner notice={resetNotice} />
        {confirmingReset ? (
          <div className="st-confirm" role="group" aria-label="모든 데이터 삭제 확인">
            <p className="small">
              {synced
                ? '이 기기와 계정에서 모두 삭제해요. 다른 기기에서도 사라지고 되돌릴 수 없어요. 남겨 둘 기록이 있다면 먼저 백업 파일을 내보내 주세요.'
                : '삭제하면 되돌릴 수 없어요. 남겨 둘 기록이 있다면 먼저 백업 파일을 내보내 주세요.'}
            </p>
            <div className="st-confirm-actions">
              <button type="button" className="btn" onClick={() => setConfirmingReset(false)} disabled={busy}>
                취소
              </button>
              <button type="button" className="btn btn--danger" onClick={() => void handleReset()} disabled={busy}>
                {busy ? '삭제하는 중…' : '모두 삭제'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--ghost st-reset-open"
            onClick={() => {
              setResetNotice(null)
              setConfirmingReset(true)
            }}
            disabled={busy}
          >
            모든 데이터 삭제
          </button>
        )}
      </section>

      <OpenOnLaunchSetting />

      <InstallEntry />

      <section className="card stack" aria-labelledby="st-about-title">
        <h2 className="st-title" id="st-about-title">
          앱 정보
        </h2>
        <ul className="st-notes small">
          <li>
            {synced
              ? '기록은 이 기기에 먼저 저장되고, 인터넷에 연결되면 계정에도 저장돼요. 오프라인에서 적은 기록은 연결됐을 때 올라가요.'
              : '기록은 이 기기의 이 브라우저에만 저장돼요. 로그인하지 않으면 서버로 보내지 않고, 다른 기기와 자동으로 맞춰지지도 않아요.'}
          </li>
          <li>
            홈 화면에 추가하면 앱처럼 쓸 수 있어요.
            <ul>
              <li>iPhone: Safari에서 공유 → 홈 화면에 추가</li>
              <li>Android: Chrome에서 메뉴 → 앱 설치</li>
            </ul>
          </li>
          <li>소비 칼로리와 목표 칼로리는 기록으로 계산한 추정치이며 의학적 조언이 아니에요. 건강에 걱정되는 점이 있으면 전문가와 상담해 주세요.</li>
        </ul>
        <p className="small muted st-version" data-testid="build-version">
          버전 {formatDateTime(__BUILD_TIME__)}
        </p>
      </section>
    </main>
  )
}
