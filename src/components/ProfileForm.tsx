import { useState } from 'react'
import type { Profile, Sex } from '../types'
import './ProfileForm.css'

/** 입력 중인 프로필. 숫자 칸은 타이핑을 막지 않도록 문자열로 들고 있는다. */
export interface ProfileDraft {
  sex: Sex | ''
  birthYear: string
  heightCm: string
  /** 현재 체중. 온보딩에서만 입력한다. */
  weightKg: string
  activityFactor: number
  goalWeightKg: string
  weeklyLossKg: number
}

export type ProfileField = 'sex' | 'birthYear' | 'heightCm' | 'weightKg' | 'goalWeightKg'
export type ProfileErrors = Partial<Record<ProfileField, string>>
export type ProfileSection = 'body' | 'activity' | 'goal'

export const ACTIVITY_OPTIONS = [
  { value: 1.2, label: '거의 앉아서 생활', hint: '사무직, 운동은 거의 하지 않아요' },
  { value: 1.375, label: '가벼운 활동', hint: '자주 걷거나 주 1~2회 가볍게 운동해요' },
  { value: 1.55, label: '주 3~5회 운동', hint: '땀이 날 정도의 운동을 꾸준히 해요' },
  { value: 1.725, label: '매일 강한 운동', hint: '매일 강하게 운동하거나 몸을 많이 쓰는 일을 해요' },
] as const

export const LOSS_OPTIONS = [
  { value: 0, label: '유지' },
  { value: 0.25, label: '0.25kg' },
  { value: 0.5, label: '0.5kg' },
  { value: 0.75, label: '0.75kg' },
] as const

export const SECTION_FIELDS: Record<ProfileSection, ProfileField[]> = {
  body: ['sex', 'birthYear', 'heightCm', 'weightKg'],
  activity: [],
  goal: ['goalWeightKg'],
}

export function emptyDraft(): ProfileDraft {
  return {
    sex: '',
    birthYear: '',
    heightCm: '',
    weightKg: '',
    activityFactor: 1.375,
    goalWeightKg: '',
    weeklyLossKg: 0.5,
  }
}

export function draftFromProfile(p: Profile): ProfileDraft {
  return {
    sex: p.sex,
    birthYear: String(p.birthYear),
    heightCm: String(p.heightCm),
    weightKg: String(p.startWeightKg),
    activityFactor: p.activityFactor,
    goalWeightKg: String(p.goalWeightKg),
    weeklyLossKg: p.weeklyLossKg,
  }
}

/** '72,5'처럼 쉼표를 소수점으로 쓴 입력도 받는다. 숫자가 아니면 NaN. */
export function parseNum(s: string): number {
  const t = s.trim().replace(',', '.')
  if (t === '' || !/^\d+(\.\d+)?$/.test(t)) return NaN
  return Number(t)
}

const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max

/**
 * 프로필 입력값을 검사한다.
 * currentWeightKg를 주면 현재 체중 칸은 검사하지 않고 그 값을 목표 체중 비교에 쓴다(설정 화면용).
 */
export function validateDraft(
  d: ProfileDraft,
  opts: { year: number; currentWeightKg?: number },
): ProfileErrors {
  const e: ProfileErrors = {}

  if (d.sex === '') e.sex = '성별을 골라 주세요.'

  const birth = parseNum(d.birthYear)
  if (!Number.isInteger(birth) || d.birthYear.trim().length !== 4) {
    e.birthYear = '태어난 해를 숫자 4자리로 입력해 주세요.'
  } else {
    const age = opts.year - birth
    if (age < 14 || age > 100) e.birthYear = '14세부터 100세까지 사용할 수 있어요. 태어난 해를 확인해 주세요.'
  }

  if (!inRange(parseNum(d.heightCm), 100, 250)) e.heightCm = '키는 100~250cm 사이로 입력해 주세요.'

  let current = opts.currentWeightKg
  if (current === undefined) {
    const w = parseNum(d.weightKg)
    if (inRange(w, 30, 300)) current = w
    else e.weightKg = '체중은 30~300kg 사이로 입력해 주세요.'
  }

  const goal = parseNum(d.goalWeightKg)
  if (!inRange(goal, 30, 300)) {
    e.goalWeightKg = '목표 체중은 30~300kg 사이로 입력해 주세요.'
  } else if (d.weeklyLossKg > 0 && current !== undefined && goal > current) {
    e.goalWeightKg = `목표 체중이 현재 체중(${current}kg)보다 높아요. 체중을 유지하려면 감량 속도에서 '유지'를 골라 주세요.`
  }

  return e
}

/** 검사를 통과한 입력값을 프로필 필드로 바꾼다. startWeightKg와 createdAt은 호출하는 쪽에서 채운다. */
export function draftToProfileFields(
  d: ProfileDraft,
): Omit<Profile, 'startWeightKg' | 'createdAt'> {
  return {
    sex: d.sex === '' ? 'F' : d.sex,
    birthYear: parseNum(d.birthYear),
    heightCm: parseNum(d.heightCm),
    activityFactor: d.activityFactor,
    goalWeightKg: parseNum(d.goalWeightKg),
    weeklyLossKg: d.weeklyLossKg,
  }
}

interface Props {
  draft: ProfileDraft
  onChange: (patch: Partial<ProfileDraft>) => void
  /** validateDraft 결과 전체. 어떤 오류를 보여 줄지는 이 컴포넌트가 정한다. */
  errors: ProfileErrors
  /** true면 아직 건드리지 않은 칸의 오류도 보여 준다(다음/저장을 누른 뒤). */
  showAllErrors?: boolean
  /** 보여 줄 묶음. 기본은 전부. */
  sections?: ProfileSection[]
  /** 현재 체중 칸을 숨긴다(설정 화면). */
  hideWeight?: boolean
  /** 한 화면에 폼이 여러 개일 때 id가 겹치지 않게 한다. */
  idPrefix?: string
}

const ALL_SECTIONS: ProfileSection[] = ['body', 'activity', 'goal']

export default function ProfileForm({
  draft,
  onChange,
  errors,
  showAllErrors = false,
  sections = ALL_SECTIONS,
  hideWeight = false,
  idPrefix = 'pf',
}: Props) {
  const [touched, setTouched] = useState<Partial<Record<ProfileField, boolean>>>({})
  const touch = (f: ProfileField) => setTouched((t) => (t[f] ? t : { ...t, [f]: true }))
  const errorOf = (f: ProfileField) => (showAllErrors || touched[f] ? errors[f] : undefined)
  const id = (name: string) => `${idPrefix}-${name}`

  const numberField = (opts: {
    field: 'birthYear' | 'heightCm' | 'weightKg' | 'goalWeightKg'
    label: string
    unit: string
    inputMode: 'numeric' | 'decimal'
    placeholder: string
    maxLength: number
  }) => {
    const err = errorOf(opts.field)
    return (
      <div className="field">
        <label htmlFor={id(opts.field)}>{opts.label}</label>
        <div className="pf-input-wrap">
          <input
            id={id(opts.field)}
            className="input"
            type="text"
            inputMode={opts.inputMode}
            autoComplete="off"
            maxLength={opts.maxLength}
            placeholder={opts.placeholder}
            value={draft[opts.field]}
            onChange={(ev) => onChange({ [opts.field]: ev.target.value })}
            onBlur={() => touch(opts.field)}
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? id(`${opts.field}-error`) : undefined}
          />
          <span className="pf-unit" aria-hidden="true">
            {opts.unit}
          </span>
        </div>
        {err && (
          <p className="field-error" id={id(`${opts.field}-error`)} role="alert">
            {err}
          </p>
        )}
      </div>
    )
  }

  const sexError = errorOf('sex')

  return (
    <div className="stack pf">
      {sections.includes('body') && (
        <>
          <div className="field" role="group" aria-labelledby={id('sex-label')}>
            <span className="label" id={id('sex-label')}>
              성별
            </span>
            <div className="segmented pf-seg">
              {(
                [
                  ['M', '남성'],
                  ['F', '여성'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.sex === value}
                  onClick={() => onChange({ sex: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            {sexError && (
              <p className="field-error" role="alert">
                {sexError}
              </p>
            )}
          </div>
          {numberField({
            field: 'birthYear',
            label: '태어난 해',
            unit: '년',
            inputMode: 'numeric',
            placeholder: '예: 1990',
            maxLength: 4,
          })}
          {numberField({
            field: 'heightCm',
            label: '키',
            unit: 'cm',
            inputMode: 'decimal',
            placeholder: '예: 170',
            maxLength: 5,
          })}
          {!hideWeight &&
            numberField({
              field: 'weightKg',
              label: '현재 체중',
              unit: 'kg',
              inputMode: 'decimal',
              placeholder: '예: 72.5',
              maxLength: 5,
            })}
        </>
      )}

      {sections.includes('activity') && (
        <div className="field" role="group" aria-labelledby={id('activity-label')}>
          <span className="label" id={id('activity-label')}>
            평소 활동량
          </span>
          <div className="pf-options">
            {ACTIVITY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className="pf-option"
                aria-pressed={draft.activityFactor === o.value}
                onClick={() => onChange({ activityFactor: o.value })}
              >
                <span className="pf-option-label">{o.label}</span>
                <span className="pf-option-hint">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {sections.includes('goal') && (
        <>
          {numberField({
            field: 'goalWeightKg',
            label: '목표 체중',
            unit: 'kg',
            inputMode: 'decimal',
            placeholder: '예: 65',
            maxLength: 5,
          })}
          <div className="field" role="group" aria-labelledby={id('loss-label')}>
            <span className="label" id={id('loss-label')}>
              일주일에 뺄 체중
            </span>
            <div className="segmented pf-seg">
              {LOSS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={draft.weeklyLossKg === o.value}
                  onClick={() => {
                    onChange({ weeklyLossKg: o.value })
                    // 속도를 바꾸면 목표 체중 오류가 생기거나 사라질 수 있어 바로 보여 준다.
                    if (draft.goalWeightKg.trim() !== '') touch('goalWeightKg')
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="muted small">
              {draft.weeklyLossKg === 0
                ? '지금 체중을 유지하는 계획을 세워요.'
                : '처음이라면 0.5kg을 권해요. 빠를수록 하루에 먹을 수 있는 양이 줄어요.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
