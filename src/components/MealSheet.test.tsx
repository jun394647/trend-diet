import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { roughKcal } from '../lib/selectors'
import { useStore } from '../store'
import MealSheet from './MealSheet'

const DATE = '2026-03-10'
const TARGET = 2000

function renderSheet() {
  const onClose = vi.fn()
  render(<MealSheet date={DATE} targetKcal={TARGET} onClose={onClose} />)
  return onClose
}

beforeEach(async () => {
  await useStore.getState().resetAll()
})

describe('MealSheet', () => {
  it('즐겨찾기가 없으면 직접 입력으로 열리고 포커스가 시트 안으로 들어간다', () => {
    renderSheet()
    const dialog = screen.getByRole('dialog', { name: '식사 추가' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: '직접 입력' })).toHaveAttribute('aria-pressed', 'true')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('직접 입력: 칼로리와 이름으로 식사를 기록하고 닫는다', async () => {
    const onClose = renderSheet()
    fireEvent.change(screen.getByLabelText('칼로리 (kcal)'), { target: { value: '550' } })
    fireEvent.change(screen.getByLabelText('이름 (선택)'), { target: { value: '김치찌개' } })
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const s = useStore.getState()
    expect(s.meals).toHaveLength(1)
    expect(s.meals[0]).toMatchObject({ date: DATE, kcal: 550, name: '김치찌개', source: 'exact' })
    expect(s.favorites).toHaveLength(0)
  })

  it('직접 입력: 칼로리가 비었거나 범위를 벗어나면 기록하지 않는다', () => {
    const onClose = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('칼로리 (kcal)'), { target: { value: '5001' } })
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    expect(useStore.getState().meals).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('직접 입력: 즐겨찾기 저장은 이름이 있을 때만 켤 수 있고, 켜면 즐겨찾기도 생긴다', async () => {
    const onClose = renderSheet()
    const check = screen.getByRole('checkbox', { name: /즐겨찾기에 저장/ })
    expect(check).toBeDisabled()

    fireEvent.change(screen.getByLabelText('칼로리 (kcal)'), { target: { value: '165' } })
    fireEvent.change(screen.getByLabelText('이름 (선택)'), { target: { value: '닭가슴살' } })
    expect(check).toBeEnabled()
    fireEvent.click(check)
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const s = useStore.getState()
    expect(s.meals[0]).toMatchObject({ name: '닭가슴살', kcal: 165, source: 'exact' })
    expect(s.favorites[0]).toMatchObject({ name: '닭가슴살', kcal: 165 })
  })

  it('즐겨찾기: 많이 쓴 순서로 보이고 한 번 누르면 기록된다', async () => {
    useStore.setState({
      favorites: [
        { id: 'a', name: '바나나', kcal: 90, useCount: 1, lastUsedAt: '2026-03-01T00:00:00.000Z' },
        { id: 'b', name: '라떼', kcal: 180, useCount: 5, lastUsedAt: '2026-02-01T00:00:00.000Z' },
        { id: 'c', name: '삶은 달걀', kcal: 70, useCount: 1, lastUsedAt: '2026-03-05T00:00:00.000Z' },
      ],
    })
    const onClose = renderSheet()
    expect(screen.getByRole('button', { name: '즐겨찾기' })).toHaveAttribute('aria-pressed', 'true')

    const rows = screen.getAllByRole('button', { name: /kcal 기록$/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      '라떼 180 kcal 기록',
      '삶은 달걀 70 kcal 기록',
      '바나나 90 kcal 기록',
    ])

    fireEvent.click(rows[0])
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const s = useStore.getState()
    expect(s.meals[0]).toMatchObject({ date: DATE, name: '라떼', kcal: 180, source: 'favorite' })
    expect(s.favorites.find((f) => f.id === 'b')?.useCount).toBe(6)
  })

  it('즐겨찾기: 삭제는 한 번 더 확인한 뒤에 한다', async () => {
    await useStore.getState().addFavorite('바나나', 90)
    const onClose = renderSheet()

    fireEvent.click(screen.getByRole('button', { name: '바나나 즐겨찾기 삭제' }))
    expect(useStore.getState().favorites).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByRole('button', { name: '바나나 90 kcal 기록' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '바나나 즐겨찾기 삭제' }))
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(useStore.getState().favorites).toHaveLength(0))
    expect(await screen.findByText(/아직 즐겨찾기가 없어요/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().meals).toHaveLength(0)
  })

  it.each([
    ['적게', 'small'],
    ['보통', 'medium'],
    ['많이', 'large'],
  ] as const)('대충 입력: %s를 누르면 목표 비율만큼 기록된다', async (label, size) => {
    const onClose = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: '대충 입력' }))
    const expected = roughKcal(size, TARGET)
    const btn = screen.getByRole('button', { name: new RegExp(`^${label}`) })
    expect(btn).toHaveTextContent(`${expected.toLocaleString('ko-KR')} kcal`)
    fireEvent.click(btn)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(useStore.getState().meals[0]).toMatchObject({
      date: DATE,
      kcal: expected,
      name: `대충 입력 · ${label}`,
      source: 'rough',
    })
  })

  it('Escape, 닫기 버튼, 바깥 영역을 누르면 닫힌다', () => {
    const onClose = renderSheet()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
