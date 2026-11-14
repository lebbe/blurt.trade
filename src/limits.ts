import { z } from 'zod'
import { charLength } from './shared/limits.ts'

// The limits themselves are in src/shared/limits.ts, which the browser can load too; this
// module adds the zod schemas the routes validate with.
export * from './shared/limits.ts'

// A trimmed string of at most `max` characters (see charLength).
export function text(max: number, message: string) {
  return z
    .string()
    .trim()
    .refine((value) => charLength(value) <= max, message)
}
