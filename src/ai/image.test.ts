import { fitWithin, ImageError, MAX_IMAGE_EDGE, prepareImage } from './image'

describe('fitWithin', () => {
  it('긴 변이 한도를 넘으면 비율을 지키며 줄인다', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1280, height: 960 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 960, height: 1280 })
    expect(fitWithin(2000, 2000)).toEqual({ width: 1280, height: 1280 })
  })

  it('한도보다 작은 사진은 키우지 않는다', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(MAX_IMAGE_EDGE, 720)).toEqual({ width: MAX_IMAGE_EDGE, height: 720 })
  })

  it('소수는 반올림하고, 아주 길쭉한 사진도 짧은 변이 1px 아래로 내려가지 않는다', () => {
    expect(fitWithin(1000, 3000)).toEqual({ width: 427, height: 1280 })
    expect(fitWithin(100000, 10)).toEqual({ width: 1280, height: 1 })
  })

  it('한도를 따로 줄 수 있다', () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 })
  })

  it('크기를 알 수 없으면 0을 돌려준다', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 })
    expect(fitWithin(100, Number.NaN)).toEqual({ width: 0, height: 0 })
    expect(fitWithin(-5, 100)).toEqual({ width: 0, height: 0 })
  })
})

describe('prepareImage', () => {
  it('사진이 아닌 파일은 받지 않고 이유를 알려 준다', async () => {
    const file = new File(['hello'], 'memo.txt', { type: 'text/plain' })
    const failure = await prepareImage(file).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ImageError)
    expect((failure as ImageError).message).toBe('사진 파일만 쓸 수 있어요.')
  })
})
