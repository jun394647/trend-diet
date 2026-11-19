import { useEffect, useMemo, useRef, useState } from 'react'
import ProfileForm from '../components/ProfileForm'
import {
  SECTION_FIELDS,
  draftToProfileFields,
  emptyDraft,
  parseNum,
  validateDraft,
  type ProfileDraft,
  type ProfileSection,
} from '../components/profileFormModel'
import { parseDate, today } from '../lib/date'
import { buildInitialCheckin } from '../lib/plan'
import { BREAK_AFTER_WEEKS, BREAK_DAYS, targetRange } from '../lib/sustain'
import { KCAL_PER_KG, computeTarget, projectGoalDate } from '../lib/tdee'
import { useStore } from '../store'
import type { DateStr, Profile } from '../types'
import { AccountAuth } from '../components/AccountPanel'
import { useSync } from '../sync/store'
import './Onboarding.css'

const STEPS = ['welcome', 'body', 'activity', 'goal', 'result'] as const
type Step = (typeof STEPS)[number]

const TITLES: Record<Step, string> = {
  welcome: '추세 다이어트',
  body: '몸 정보를 알려 주세요',
  activity: '평소에 얼마나 움직이나요?',
  goal: '목표를 정해 주세요',
  result: '이렇게 시작해요',
}

const FORM_STEPS: Partial<Record<Step, ProfileSection>> = {
  body: 'body',
  activity: 'activity',
  goal: 'goal',
}

const kcal = (n: number) => n.toLocaleString('ko-KR')

function formatFullDate(s: string): string {
  const d = parseDate(s)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

function buildProfile(draft: ProfileDraft, date: DateStr): Profile {
  const fields = draftToProfileFields(draft)
  return {
    ...fields,
    startWeightKg: parseNum(draft.weightKg),
    phase: fields.weeklyLossKg > 0 ? 'lose' : 'maintain',
    phaseStartedAt: date,
    breakUntil: null,
    createdAt: new Date().toISOString(),
  }
}

export default function Onboarding() {
  const [stepIndex, setStepIndex] = useState(0)
  const [showLogin, setShowLogin] = useState(false)
  const syncEnabled = useSync((s) => s.enabled)
  const syncEmail = useSync((s) => s.email)
  const syncConflict = useSync((s) => s.conflict)
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft)
  const [attempted, setAttempted] = useState<Partial<Record<Step, boolean>>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  const step = STEPS[stepIndex]
  const section = FORM_STEPS[step]
  const date = today()
  const errors = useMemo(
    () => validateDraft(draft, { year: parseDate(date).getFullYear() }),
    [draft, date],
  )

  // 단계가 바뀌면 화면 맨 위로 올리고, 화면 낭독기가 새 제목을 읽도록 초점을 옮긴다.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    window.scrollTo?.(0, 0)
    titleRef.current?.focus()
  }, [stepIndex])

  const goNext = () => {
    if (section) {
      const hasError = SECTION_FIELDS[section].some((f) => errors[f])
      if (hasError) {
        setAttempted((a) => ({ ...a, [step]: true }))
        return
      }
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  }

  const goBack = () => {
    setSaveError(null)
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  const confirm = async () => {
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    setSaveError(null)
    try {
      await useStore.getState().completeOnboarding(buildProfile(draft, today()))
      // 저장되면 App이 메인 화면으로 바꾸므로 여기서 더 할 일은 없다.
    } catch {
      setSaveError('저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요.')
      setSaving(false)
    }
  }

  return (
    <main className="page page--no-tabbar ob">
      <header className="ob-header">
        <div
          className="ob-progress"
          role="progressbar"
          aria-label="설정 진행 단계"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={stepIndex + 1}
          aria-valuetext={`${STEPS.length}단계 중 ${stepIndex + 1}단계`}
        >
          {STEPS.map((s, i) => (
            <span key={s} className={i <= stepIndex ? 'ob-dot ob-dot--on' : 'ob-dot'} />
          ))}
        </div>
        <h1 className="page-title ob-title" ref={titleRef} tabIndex={-1}>
          {TITLES[step]}
        </h1>
      </header>

      {step === 'welcome' && (
        <section className="stack ob-body">
          <p className="ob-lead">
            하루하루를 따지지 않고 한 주 평균으로 봐요. 그리고 내 몸이 실제로 반응하는 만큼 계획을
            맞춰 가요.
          </p>
          {syncEnabled ? (
            <p className="banner">
              기록은 이 기기에 저장돼요. 로그인하면 계정에도 저장돼서 다른 기기에서 이어 쓸 수 있어요.
            </p>
          ) : (
            <p className="banner">기록은 이 기기에만 저장돼요. 가입이나 로그인은 필요 없어요.</p>
          )}
          <p className="muted small">시작하기 전에 몇 가지만 여쭤볼게요. 1분이면 끝나요.</p>
          {syncEnabled &&
            (syncEmail && !syncConflict ? (
              <p className="small muted" role="status">
                {syncEmail}(으)로 로그인했어요. 이 계정에는 아직 기록이 없으니 이어서 진행해 주세요.
              </p>
            ) : showLogin || syncConflict ? (
              <div className="well">
                <AccountAuth />
              </div>
            ) : (
              <button type="button" className="btn btn--block" onClick={() => setShowLogin(true)}>
                쓰던 계정으로 로그인하기
              </button>
            ))}
        </section>
      )}

      {section && (
        <section className="ob-body">
          {step === 'body' && (
            <p className="muted ob-desc">하루에 쓰는 칼로리를 어림하는 데 사용해요.</p>
          )}
          {step === 'activity' && (
            <p className="muted ob-desc">
              가장 가까운 것을 하나 골라 주세요. 기록이 쌓이면 실제 값으로 맞춰 가니 정확하지 않아도
              괜찮아요.
            </p>
          )}
          {step === 'goal' && (
            <p className="muted ob-desc">
              현재 체중은 {draft.weightKg.trim()}kg이에요. 속도는 나중에 설정에서 바꿀 수 있어요.
            </p>
          )}
          <ProfileForm
            key={step}
            draft={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            errors={errors}
            showAllErrors={attempted[step] === true}
            sections={[section]}
            idPrefix="ob"
          />
        </section>
      )}

      {step === 'result' && <Result draft={draft} date={date} valid={Object.keys(errors).length === 0} />}

      {saveError && (
        <p className="banner banner--danger" role="alert">
          {saveError}
        </p>
      )}

      <footer className="ob-actions">
        {stepIndex > 0 && (
          <button type="button" className="btn btn--lg" onClick={goBack} disabled={saving}>
            이전
          </button>
        )}
        {step === 'result' ? (
          <button
            type="button"
            className="btn btn--primary btn--lg ob-next"
            onClick={() => void confirm()}
            disabled={saving || Object.keys(errors).length > 0}
          >
            {saving ? '저장하는 중…' : '이 계획으로 시작하기'}
          </button>
        ) : (
          <button type="button" className="btn btn--primary btn--lg ob-next" onClick={goNext}>
            {step === 'welcome' ? '시작하기' : '다음'}
          </button>
        )}
      </footer>
    </main>
  )
}

function Result({ draft, date, valid }: { draft: ProfileDraft; date: string; valid: boolean }) {
  if (!valid) {
    return (
      <p className="banner banner--warn" role="alert">
        입력한 값에 확인할 부분이 있어요. 이전 단계로 돌아가 고쳐 주세요.
      </p>
    )
  }

  const profile = buildProfile(draft, date)
  const checkin = buildInitialCheckin(profile, date)
  const target = computeTarget({
    tdee: checkin.estimatedTdee,
    weeklyLossKg: profile.weeklyLossKg,
    sex: profile.sex,
    weightKg: profile.startWeightKg,
  })
  const range = targetRange(checkin.targetKcal)
  const losing = profile.weeklyLossKg > 0
  // 하한에 걸리면 실제 감량 속도가 달라지므로 실제 적자 기준으로 다시 계산한다.
  const effectiveWeeklyLoss = target.flooredAtMin
    ? Math.max(0, ((checkin.estimatedTdee - checkin.targetKcal) * 7) / KCAL_PER_KG)
    : target.appliedWeeklyLossKg
  const goalDate =
    losing && profile.startWeightKg > profile.goalWeightKg && effectiveWeeklyLoss > 0
      ? projectGoalDate({
          trendKg: profile.startWeightKg,
          goalKg: profile.goalWeightKg,
          weeklyLossKg: effectiveWeeklyLoss,
          from: date,
        })
      : null
  const appliedLabel = `${Math.round(target.appliedWeeklyLossKg * 100) / 100}kg`
  const paceLabel = `${Math.round(effectiveWeeklyLoss * 100) / 100}kg`

  return (
    <section className="stack ob-body ob-result">
      <div className="panel ob-plan">
        <h2 className="card-title">{losing ? '하루 목표 범위' : '하루 유지 범위'}</h2>
        <p className="big-num ob-range">
          <span data-testid="target-range">
            {kcal(range.low)}~{kcal(range.high)}
          </span>
          <span className="unit">kcal</span>
        </p>
        <p className="ob-plan-msg">
          {losing
            ? effectiveWeeklyLoss > 0
              ? `이 범위 안에서 먹으면 일주일에 ${paceLabel}쯤 빠질 것으로 예상해요.`
              : '이 범위 안에서 먹는 걸 목표로 해요.'
            : '쓰는 만큼 먹어서 지금 체중을 지키는 계획이에요.'}
        </p>
        <dl className="ob-facts">
          <div>
            <dt>예상 하루 소비 칼로리</dt>
            <dd className="num" data-testid="tdee-kcal">
              {kcal(checkin.estimatedTdee)}kcal
            </dd>
          </div>
          {goalDate && (
            <div>
              <dt>목표 체중 도달 예상</dt>
              <dd className="num">{formatFullDate(goalDate)}쯤</dd>
            </div>
          )}
        </dl>
      </div>

      {target.lossCapped && (
        <p className="banner banner--warn">
          고른 속도가 체중에 비해 빨라서, 일주일에 체중의 1%({appliedLabel})까지만 빼도록 낮췄어요.
        </p>
      )}
      {target.flooredAtMin && (
        <p className="banner banner--warn">
          계산한 값이 너무 낮아서 목표를 안전한 최소 섭취량인 {kcal(checkin.targetKcal)}kcal로
          맞췄어요. 그래서 고른 속도보다 천천히 빠질 수 있어요.
        </p>
      )}

      <div className="card">
        <h2 className="card-title">이 계획은 이렇게 이어 가요</h2>
        <ul className="ob-how">
          <li>하루가 아니라 한 주 평균으로 봐요. 하루쯤 범위를 벗어나도 괜찮아요.</li>
          <li>2~3주 기록이 쌓이면 실제 변화에 맞춰 목표를 다시 계산해요.</li>
          {losing && (
            <li>
              감량이 {BREAK_AFTER_WEEKS}주쯤 이어지면 {BREAK_DAYS / 7}주 쉬어 가기를 권해요.
            </li>
          )}
        </ul>
      </div>

      <p className="muted small">
        키, 체중, 나이, 활동량으로 계산한 추정치이며 의학적 조언이 아니에요. 건강에 걱정되는 점이
        있으면 전문가와 상담해 주세요.
      </p>
    </section>
  )
}
