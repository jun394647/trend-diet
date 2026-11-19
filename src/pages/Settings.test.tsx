import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { today } from '../lib/date'
import { useStore } from '../store'
import type { Profile } from '../types'
import Settings from './Settings'

const profile: Profile = {
  sex: 'M',
  birthYear: new Date().getFullYear() - 30,
  heightCm: 175,
  activityFactor: 1.55,
  startWeightKg: 80,
  goalWeightKg: 72,
  weeklyLossKg: 0.5,
  createdAt: new Date().toISOString(),
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const fmt = (n: number) => n.toLocaleString('ko-KR')
const rangeOf = (target: number) => `${fmt(target - 100)}~${fmt(target + 100)}`
const target = () => useStore.getState().checkins[0].targetKcal

function pickFile(text: string) {
  const file = new File([text], 'backup.json', { type: 'application/json' })
  fireEvent.change(screen.getByLabelText('가져올 백업 파일 선택'), { target: { files: [file] } })
}

beforeEach(async () => {
  await useStore.getState().resetAll()
  await useStore.getState().completeOnboarding(profile)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Settings', () => {
  it('내보내기를 누르면 백업 파일을 내려받고 마지막 백업 시각을 기록한다', async () => {
    const blobs: Blob[] = []
    const createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b)
      return 'blob:test'
    })
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    let downloadName = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download
    })

    render(<Settings />)
    expect(screen.getByText('아직 백업한 적이 없어요.')).toBeInTheDocument()

    click('백업 파일 내보내기')

    await waitFor(() => expect(useStore.getState().lastBackupAt).not.toBeNull())
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    expect(downloadName).toBe(`trend-diet-backup-${today()}.json`)
    expect(blobs[0]).toBeInstanceOf(Blob)
    expect(blobs[0].size).toBeGreaterThan(0)
    expect(await screen.findByText(/마지막 백업:/)).toBeInTheDocument()
  })

  it('exportBackup은 백업 형식의 JSON 문자열을 돌려준다', async () => {
    const text = await useStore.getState().exportBackup()
    expect(typeof text).toBe('string')
    expect(JSON.parse(text)).toMatchObject({ app: 'trend-diet', version: 1 })
  })

  it('잘못된 파일을 가져오면 오류를 보여 주고 기존 기록은 그대로 둔다', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<Settings />)

    pickFile('이건 JSON이 아니에요')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveClass('banner--danger')
    expect(alert.textContent).toMatch(/가져오지 못했어요/)
    expect(alert.textContent).toMatch(/JSON 형식이 아니에요/)
    expect(useStore.getState().profile).toMatchObject({ startWeightKg: 80 })
    expect(useStore.getState().checkins).toHaveLength(1)
  })

  it('가져오기 확인을 취소하면 아무것도 바꾸지 않는다', async () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const importBackup = vi.spyOn(useStore.getState(), 'importBackup')
    render(<Settings />)

    pickFile('{}')

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(importBackup).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('내 정보를 저장하면 새 목표 칼로리를 알려 준다', async () => {
    render(<Settings />)
    const before = useStore.getState().checkins[0].targetKcal

    fireEvent.click(screen.getByRole('radio', { name: /천천히/ }))
    click('내 정보 저장')

    const status = await screen.findByRole('status')
    const after = target()
    expect(useStore.getState().profile?.weeklyLossKg).toBe(0.25)
    expect(after).toBeGreaterThan(before)
    expect(status.textContent).toContain(`하루 목표 범위는 ${rangeOf(after)}kcal`)
    expect(useStore.getState().profile?.startWeightKg).toBe(80)
    // 감량 속도만 바꾼 것이라 단계는 그대로다.
    expect(useStore.getState().profile?.phase).toBeUndefined()
    expect(screen.getByTestId('st-phase-chip')).toHaveTextContent('감량 1주차')
    expect(screen.getByTestId('st-phase-range')).toHaveTextContent(rangeOf(after))
  })

  it('내 정보에서 속도를 유지로 바꾸면 유지 단계가 되고, 다시 감량 속도를 고르면 감량 단계가 된다', async () => {
    render(<Settings />)

    fireEvent.click(screen.getByRole('radio', { name: '유지' }))
    click('내 정보 저장')
    await waitFor(() => expect(useStore.getState().profile?.phase).toBe('maintain'))
    expect(useStore.getState().profile).toMatchObject({ weeklyLossKg: 0, phaseStartedAt: today(), breakUntil: null })
    await screen.findByRole('status')
    expect(target()).toBe(Math.round(useStore.getState().checkins[0].estimatedTdee / 10) * 10)
    expect(screen.getByText('유지 중')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /보통/ }))
    click('내 정보 저장')
    await waitFor(() => expect(useStore.getState().profile?.phase).toBe('lose'))
    expect(useStore.getState().profile).toMatchObject({ weeklyLossKg: 0.5, phaseStartedAt: today() })
  })

  it('쉬어 가는 유지 기간에 내 정보를 저장해도 단계와 끝나는 날은 그대로다', async () => {
    const resting: Profile = { ...profile, phase: 'maintain', phaseStartedAt: '2026-01-05', breakUntil: '2026-01-19' }
    await useStore.getState().updateProfile(resting)
    render(<Settings />)
    expect(screen.getByText(/감량을 다시 시작할 때부터 적용돼요/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /천천히/ }))
    click('내 정보 저장')

    await screen.findByRole('status')
    expect(useStore.getState().profile).toMatchObject({
      weeklyLossKg: 0.25,
      phase: 'maintain',
      phaseStartedAt: '2026-01-05',
      breakUntil: '2026-01-19',
    })
  })

  it('지금 단계: 유지 기간으로 바꾸면 확인을 받은 뒤 목표가 올라가고 단계가 바뀐다', async () => {
    render(<Settings />)
    const before = target()
    expect(screen.getByTestId('st-phase-chip')).toHaveTextContent('감량 1주차')
    expect(screen.getByTestId('st-phase-range')).toHaveTextContent(rangeOf(before))

    click('유지 기간으로 바꾸기')
    // 확인하기 전에는 아무것도 바뀌지 않는다.
    expect(useStore.getState().profile?.phase).toBeUndefined()
    click('취소')
    expect(target()).toBe(before)

    click('유지 기간으로 바꾸기')
    click('유지로 바꾸기')

    const status = await screen.findByRole('status')
    expect(useStore.getState().profile?.phase).toBe('maintain')
    const after = target()
    expect(after).toBeGreaterThan(before)
    expect(after).toBe(Math.round(useStore.getState().checkins[0].estimatedTdee / 10) * 10)
    expect(useStore.getState().profile).toMatchObject({ phaseStartedAt: today(), breakUntil: null, weeklyLossKg: 0.5 })
    expect(screen.getByTestId('st-phase-chip')).toHaveTextContent('유지 중')
    expect(screen.getByTestId('st-phase-range')).toHaveTextContent(rangeOf(after))
    expect(status.textContent).toContain(`하루 유지 범위는 ${rangeOf(after)}kcal`)
  })

  it('지금 단계: 유지 중에 감량을 다시 시작하면 목표가 내려가고, 속도가 없으면 0.5kg으로 잡는다', async () => {
    await useStore.getState().updateProfile({ ...profile, weeklyLossKg: 0, phase: 'maintain' })
    render(<Settings />)
    const before = target()

    click('감량 다시 시작하기')
    click('감량 시작하기')

    await screen.findByRole('status')
    expect(useStore.getState().profile).toMatchObject({
      phase: 'lose',
      weeklyLossKg: 0.5,
      phaseStartedAt: today(),
      breakUntil: null,
    })
    expect(target()).toBeLessThan(before)
    // 내 정보 폼도 새 속도를 보여 준다.
    expect(screen.getByRole('radio', { name: /보통/ })).toBeChecked()
  })

  it('지금 단계: 체중이 목표 체중 이하이면 감량을 다시 시작할 수 없다', async () => {
    await useStore.getState().updateProfile({ ...profile, phase: 'maintain', goalWeightKg: 80 })
    render(<Settings />)

    const button = screen.getByRole('button', { name: '감량 다시 시작하기' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/감량을 다시 시작할 수 없어요/)).toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.queryByRole('button', { name: '감량 시작하기' })).not.toBeInTheDocument()
    expect(useStore.getState().profile?.phase).toBe('maintain')
  })

  it('모든 데이터 삭제는 확인을 받은 뒤 프로필을 지운다', async () => {
    render(<Settings />)

    click('모든 데이터 삭제')
    // 확인 줄이 열릴 뿐, 아직 지우지 않는다.
    const confirmRow = screen.getByRole('group', { name: '모든 데이터 삭제 확인' })
    expect(confirmRow.textContent).toMatch(/되돌릴 수 없/)
    expect(useStore.getState().profile).not.toBeNull()

    click('취소')
    expect(screen.queryByRole('group', { name: '모든 데이터 삭제 확인' })).not.toBeInTheDocument()
    expect(useStore.getState().profile).not.toBeNull()

    click('모든 데이터 삭제')
    click('모두 삭제')

    await waitFor(() => expect(useStore.getState().profile).toBeNull())
  })
})
