import { randomInt } from 'node:crypto'
import { z } from 'zod'
import {
  avatarPalettes,
  colorPattern,
  eyeTypes,
  hairTypes,
  headWidths,
  toothTypes,
  type Avatar,
} from './shared/avatar.ts'

// What an avatar is made of, and its labels and URLs, are in src/shared/avatar.ts, which the
// browser can load too. This module adds what only the server does: random avatars for new
// profiles (node:crypto) and the zod schema the edit form is checked with.
export * from './shared/avatar.ts'

function pick<T>(values: readonly T[]): T {
  return values[randomInt(values.length)]
}

export function randomAvatar(): Avatar {
  return {
    headWidth: pick(headWidths),
    skin: pick(avatarPalettes.skin),
    hairType: pick(hairTypes),
    hairColor: pick(avatarPalettes.hairColor),
    eyeType: pick(eyeTypes),
    eyeColor: pick(avatarPalettes.eyeColor),
    pupilColor: pick(avatarPalettes.pupilColor),
    // Mostly some teeth: a toothless mouth just looks closed.
    toothType: pick(toothTypes.filter((type) => type !== 'none')),
    toothColor: pick(avatarPalettes.toothColor),
  }
}

// What <input type="color"> sends: #rrggbb, always lower case (upper case is accepted too).
const color = (label: string) =>
  z
    .string(`${label} is required`)
    .trim()
    .toLowerCase()
    .regex(colorPattern, `${label} must be a colour like #a1b2c3`)

export const avatarSchema = z.object({
  headWidth: z.enum(headWidths, 'Pick a head width'),
  skin: color('Skin colour'),
  hairType: z.enum(hairTypes, 'Pick a hair type'),
  hairColor: color('Hair colour'),
  eyeType: z.enum(eyeTypes, 'Pick an eye type'),
  eyeColor: color('Eye colour'),
  pupilColor: color('Pupil colour'),
  toothType: z.enum(toothTypes, 'Pick a tooth type'),
  toothColor: color('Tooth colour'),
})
