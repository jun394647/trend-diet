/** 디스코드가 보낸 요청인지 확인한다: Ed25519 서명이 `timestamp + 본문`에 대한 것이어야 한다. */

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** 헤더가 없거나 형식이 틀리거나 서명이 맞지 않으면 false. 던지지 않는다. */
export async function verifyDiscordSignature(args: {
  publicKey: string
  signature: string | null
  timestamp: string | null
  body: string
}): Promise<boolean> {
  const { publicKey, signature, timestamp, body } = args
  if (!signature || !timestamp) return false
  const key = hexToBytes(publicKey.trim())
  const sig = hexToBytes(signature.trim())
  if (!key || key.length !== 32 || !sig || sig.length !== 64) return false
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'Ed25519', false, ['verify'])
    const message = new TextEncoder().encode(timestamp + body)
    return await crypto.subtle.verify('Ed25519', cryptoKey, sig, message)
  } catch {
    return false
  }
}
