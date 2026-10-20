import { z } from 'zod'

// Upper bounds on everything a client sends. Validation rejects anything over a limit
// with a 400 naming the field; nothing is silently truncated. The database repeats the
// text limits as CHECK constraints. See "Input limits" in docs/routes.md.

export const blurtMaxLength = 280
export const blurtMaxNewlines = 5
export const bioMaxLength = 4000
export const reportReasonMaxLength = 500
// Homepage and social fields.
export const linkMaxLength = 200
export const usernameMaxLength = 40
export const passwordMinLength = 8
// Keeps Argon2 from hashing huge inputs: at most 800 bytes in UTF-8.
export const passwordMaxLength = 200
// An invite code is 12 characters; this leaves room for the spaces and dashes people type.
export const inviteCodeMaxLength = 40
// ?q= on /search: more than enough words for a search, and bounds the tsquery's work.
export const searchQueryMaxLength = 200
// A cursor is about 40 characters; anything much longer isn't one.
export const cursorMaxLength = 100

// Request bodies, form-encoded or JSON. The biggest real one is the profile form, a full
// bio of 4-byte characters percent-encoded: about 48 KB. Bigger bodies get a 413.
export const bodyLimit = '64kb'

// An uploaded picture, before it is redrawn (src/picture.ts); nginx allows a bit more.
export const pictureMaxUploadBytes = 15 * 1024 * 1024
// Pictures are drawn in worker threads (src/picture-pool.ts): few, as the server has few
// cores and sharp uses the libuv threadpool too. Uploads wait in a queue, in memory; when it
// is full a blurt gets a 503. A picture that takes longer than the timeout is refused.
export const pictureWorkers = 2
export const pictureQueueLimit = 8
export const pictureTaskTimeoutMs = 4000
// The stored drawing; the blurt_pictures table repeats it as a CHECK constraint.
export const pictureMaxStoredBytes = 65536

// Characters as people count them, and as Postgres' char_length() does: code points, not
// UTF-16 units (an emoji is one, not two) or bytes.
export function charLength(text: string): number {
  return [...text].length
}

// A trimmed string of at most `max` characters (see charLength).
export function text(max: number, message: string) {
  return z
    .string()
    .trim()
    .refine((value) => charLength(value) <= max, message)
}

const webUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    if (!/^https?:\/\//i.test(value)) {
      return false
    }
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  })

// http(s) only, so a user-submitted link can never be javascript: or data:.
export function isWebUrl(value: string): boolean {
  return webUrlSchema.safeParse(value).success
}

const trackingParamPattern =
  /^(?:utm_.*|gad_.*|fbclid|gclid|gbraid|wbraid|dclid|_gl|msclkid|ttclid|twclid|li_fat_id|yclid|mc_eid|mc_cid|_hsenc|_hsmi|mkt_tok|igshid|igsh)$/i

// `si` is a share-tracking id on these hosts, but an ordinary parameter elsewhere.
const shareIdHostPattern = /(?:^|\.)(?:open\.spotify\.com|youtube\.com|youtu\.be)$/i

export function normalizedWebUrl(value: string): string | undefined {
  const result = webUrlSchema.safeParse(value)
  if (!result.success) {
    return undefined
  }
  const url = new URL(result.data)
  const stripShareId = shareIdHostPattern.test(url.hostname)
  const searchParams = new URLSearchParams()
  let stripped = false
  url.searchParams.forEach((value, key) => {
    if (trackingParamPattern.test(key) || (stripShareId && key.toLowerCase() === 'si')) {
      stripped = true
    } else {
      searchParams.append(key, value)
    }
  })
  if (!stripped) {
    return value
  }
  url.search = searchParams.toString()
  return url.href
}
