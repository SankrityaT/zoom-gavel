// Decrypts Zoom's x-zoom-app-context header (sent on the Home URL request).
//
// Wire format, base64: [ivLen:1][iv][aadLen:2 LE][aad][cipherLen:4 LE][cipher][tag:16]
// AES-256-GCM, key = SHA-256(client secret). Pure Web Crypto so it runs in
// the proxy, route handlers, and tests alike.
//
// Zoom's own sample accepts any tag length, which lets an attacker forge the
// header. Here the layout must account for every byte exactly and GCM is
// told the tag is 128 bits, so a forged or truncated tag fails to decrypt.

export type ZoomAppContext = {
  uid: string
  mid: string | null
  typ?: string
  act?: string
  ts?: number
  exp: number
}

const TAG_BYTES = 16

function base64ToBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function decryptZoomContext(
  header: string,
  clientSecret: string,
  now: number = Date.now(),
): Promise<ZoomAppContext> {
  const bytes = base64ToBytes(header)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0

  if (bytes.byteLength < 1) throw new Error('context: empty')
  const ivLength = view.getUint8(offset)
  offset += 1
  if (ivLength < 12 || ivLength > 16) throw new Error('context: bad iv length')
  const iv = bytes.subarray(offset, offset + ivLength)
  offset += ivLength

  if (offset + 2 > bytes.byteLength) throw new Error('context: truncated aad length')
  const aadLength = view.getUint16(offset, true)
  offset += 2
  const aad = bytes.subarray(offset, offset + aadLength)
  offset += aadLength

  if (offset + 4 > bytes.byteLength) throw new Error('context: truncated cipher length')
  const cipherLength = view.getUint32(offset, true)
  offset += 4
  if (cipherLength === 0) throw new Error('context: empty ciphertext')
  const cipher = bytes.subarray(offset, offset + cipherLength)
  offset += cipherLength

  const tag = bytes.subarray(offset, offset + TAG_BYTES)
  offset += TAG_BYTES
  if (offset !== bytes.byteLength) throw new Error('context: bad layout')

  const keyBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(clientSecret),
  )
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
    'decrypt',
  ])

  const sealed = new Uint8Array(new ArrayBuffer(cipher.byteLength + tag.byteLength))
  sealed.set(cipher, 0)
  sealed.set(tag, cipher.byteLength)

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    sealed,
  )
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>

  if (typeof parsed.uid !== 'string' || !parsed.uid) throw new Error('context: missing uid')
  if (typeof parsed.exp !== 'number' || parsed.exp <= now) throw new Error('context: expired')

  return {
    uid: parsed.uid,
    mid: typeof parsed.mid === 'string' && parsed.mid ? parsed.mid : null,
    typ: typeof parsed.typ === 'string' ? parsed.typ : undefined,
    act: typeof parsed.act === 'string' ? parsed.act : undefined,
    ts: typeof parsed.ts === 'number' ? parsed.ts : undefined,
    exp: parsed.exp,
  }
}
