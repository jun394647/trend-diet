/**
 * 음식 사진을 AI에 보내기 좋은 크기로 줄인다.
 * 긴 변을 1280px 이하로 맞추고 JPEG로 다시 저장해, 전송량과 비용을 줄인다.
 */
import { MAX_IMAGE_BASE64 } from './contract'

/** 줄인 사진의 긴 변 최대 길이(px). */
export const MAX_IMAGE_EDGE = 1280
const JPEG_QUALITY = 0.82

export interface PreparedImage {
  /** data URL 머리말을 뺀 base64. */
  base64: string
  mediaType: 'image/jpeg'
  /** 미리 보기용 object URL. 다 쓰면 부른 쪽에서 URL.revokeObjectURL로 풀어 준다. */
  previewUrl: string
}

/** 사진을 준비하지 못했을 때 던진다. message는 사용자에게 그대로 보여 줄 수 있다. */
export class ImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageError'
  }
}

/** 비율을 지키면서 긴 변이 maxEdge를 넘지 않는 크기를 구한다. 작은 사진은 키우지 않는다. */
export function fitWithin(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !(maxEdge > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

function decodeWithImg(file: File): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () =>
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    img.src = url
  })
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 휴대폰 사진은 방향 정보가 따로 들어 있어, 그대로 그리면 옆으로 누울 수 있다.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      // 아래의 <img> 방식으로 다시 해 본다.
    }
  }
  return decodeWithImg(file)
}

function toJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

const CANNOT_OPEN = '이 사진은 열 수 없어요. 다른 사진으로 해 주세요.'

/** 고른 사진을 줄여 base64와 미리 보기 주소로 돌려준다. 실패하면 ImageError를 던진다. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  // 종류를 알 수 없는 파일(type이 빈 값)은 일단 열어 보고 판단한다.
  if (file.type !== '' && !file.type.startsWith('image/')) {
    throw new ImageError('사진 파일만 쓸 수 있어요.')
  }

  let decoded: Decoded
  try {
    decoded = await decode(file)
  } catch {
    throw new ImageError(CANNOT_OPEN)
  }

  let blob: Blob | null
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height)
    if (width === 0 || height === 0) throw new ImageError(CANNOT_OPEN)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageError(CANNOT_OPEN)
    // 투명한 부분이 JPEG에서 검게 나오지 않게 흰 바탕을 깐다.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(decoded.source, 0, 0, width, height)
    blob = await toJpegBlob(canvas)
  } catch (e) {
    throw e instanceof ImageError ? e : new ImageError(CANNOT_OPEN)
  } finally {
    decoded.release()
  }
  if (!blob) throw new ImageError(CANNOT_OPEN)

  let base64: string
  try {
    base64 = await toBase64(blob)
  } catch {
    throw new ImageError(CANNOT_OPEN)
  }
  if (base64 === '') throw new ImageError(CANNOT_OPEN)
  if (base64.length > MAX_IMAGE_BASE64) {
    throw new ImageError('사진이 너무 커요. 다른 사진으로 해 주세요.')
  }
  return { base64, mediaType: 'image/jpeg', previewUrl: URL.createObjectURL(blob) }
}
