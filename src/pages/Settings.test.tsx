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

    click('0.25kg')
    click('내 정보 저장')

    const status = await screen.findByRole('status')
    const after = useStore.getState().checkins[0].targetKcal
    expect(useStore.getState().profile?.weeklyLossKg).toBe(0.25)
    expect(after).toBeGreaterThan(before)
    expect(status.textContent).toContain(`${after.toLocaleString('ko-KR')}kcal`)
    expect(useStore.getState().profile?.startWeightKg).toBe(80)
  })

  it('모든 데이터 삭제는 확인을 받은 뒤 프로필을 지운다', async () => {
    const confirm = vi.fn((_message?: string) => true)
    vi.stubGlobal('confirm', confirm)
    render(<Settings />)

    click('모든 데이터 삭제')

    await waitFor(() => expect(useStore.getState().profile).toBeNull())
    expect(confirm.mock.calls[0]?.[0]).toMatch(/되돌릴 수 없/)
  })
})
