/**
 * seal — multi-stage, date-rotating OBFUSCATION for the public /dubai/areas payload.
 *
 * HONEST SCOPE: the passphrases ALSO ship in the frontend bundle (they must, to
 * decrypt for rendering). So this is obfuscation, not real secrecy — it raises
 * copying from "right-click → copy the JSON" to "read our JS, replicate the
 * multi-stage + daily-rotating decrypt". It stops casual/drive-by copying and
 * makes a recorded scraper break every day; it does NOT stop a determined
 * scripter. See docs/area-blocks-protection-spec.md.
 *
 * Stages (client decrypts in reverse):
 *   gzip(json)                                   ← small payload
 *   → AES-256-GCM, key = H(VEIL_PASS : utcDate)  ← rotates daily
 *   → XOR with keystream from H(XOR_PASS : utcDate : blockIdx)  ← second layer
 * Wire format after XOR: the XOR'd bytes of [ iv(12) | gcmTag(16) | ciphertext ].
 */
import crypto from 'crypto'
import zlib from 'zlib'

const VEIL_PASS = 'pinzos-area-veil-v1' // AES key material (bump to rotate scheme)
const XOR_PASS = 'pinzos-area-xor-v1'   // second-layer keystream material

/** UTC YYYY-MM-DD used as the daily rotation salt. */
export function utcDateStr(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function dailyKey(pass: string, date: string): Buffer {
  return crypto.createHash('sha256').update(`${pass}:${date}`).digest() // 32 bytes
}

/** Expand H(pass:date:i) blocks into a keystream of `len` bytes. */
function keystream(pass: string, date: string, len: number): Buffer {
  const out = Buffer.alloc(len)
  for (let i = 0; i * 32 < len; i++) {
    crypto.createHash('sha256').update(`${pass}:${date}:${i}`).digest().copy(out, i * 32)
  }
  return out.subarray(0, len)
}

/** Seal a gzip buffer for the given UTC date → XOR(AES-GCM(gzip)). */
export function seal(gzipped: Buffer, date: string = utcDateStr()): Buffer {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', dailyKey(VEIL_PASS, date), iv)
  const ct = Buffer.concat([cipher.update(gzipped), cipher.final()])
  const blob = Buffer.concat([iv, cipher.getAuthTag(), ct]) // [12 | 16 | N]
  const ks = keystream(XOR_PASS, date, blob.length)
  for (let i = 0; i < blob.length; i++) blob[i] ^= ks[i]
  return blob
}

/** Reverse seal() → the original JSON bytes. For our own node tools (leak-check). */
export function unseal(sealed: Buffer, date: string = utcDateStr()): Buffer {
  const x = Buffer.from(sealed)
  const ks = keystream(XOR_PASS, date, x.length)
  for (let i = 0; i < x.length; i++) x[i] ^= ks[i]
  const iv = x.subarray(0, 12), tag = x.subarray(12, 28), ct = x.subarray(28)
  const dec = crypto.createDecipheriv('aes-256-gcm', dailyKey(VEIL_PASS, date), iv)
  dec.setAuthTag(tag)
  return zlib.gunzipSync(Buffer.concat([dec.update(ct), dec.final()]))
}
