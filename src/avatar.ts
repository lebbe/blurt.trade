import { randomInt } from 'node:crypto'
import { z } from 'zod'

// The profile avatar: a cut-out cartoon face whose whole top half flaps up and down to talk.
// It is never an uploaded image, only these few choices, stored as JSON on the profile
// (user_profiles.avatar) and drawn as inline SVG by src/templates/avatar.ts. Colours are
// any #rrggbb (an <input type="color">); the types are fixed lists.
export const hairTypes = ['bald', 'tuft', 'flat', 'spiky', 'mohawk', 'afro'] as const
export const eyeTypes = ['classic', 'dots', 'round', 'wide', 'sleepy', 'angry'] as const
export const toothTypes = ['none', 'two', 'buck', 'gap', 'full'] as const

export type HairType = (typeof hairTypes)[number]
export type EyeType = (typeof eyeTypes)[number]
export type ToothType = (typeof toothTypes)[number]

export type Avatar = {
  skin: string
  hairType: HairType
  hairColor: string
  eyeType: EyeType
  eyeColor: string
  pupilColor: string
  toothType: ToothType
  toothColor: string
}

export const avatarLabels: Record<HairType | EyeType | ToothType, string> = {
  bald: 'Bald',
  tuft: 'Tuft',
  flat: 'Flat',
  spiky: 'Spiky',
  mohawk: 'Mohawk',
  afro: 'Afro',
  classic: 'Classic',
  dots: 'Dots',
  round: 'Round',
  wide: 'Wide',
  sleepy: 'Sleepy',
  angry: 'Angry',
  none: 'None',
  two: 'Two front teeth',
  buck: 'Buck tooth',
  gap: 'Gap',
  full: 'Full set',
}

// Random avatars only take colours from these, so they look normal-ish. People can pick
// any colour themselves. db/migrations/1791690000000_profile-avatar.sql has a copy, for
// the profiles that existed before avatars did.
export const avatarPalettes = {
  skin: ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd', '#f5cfa0', '#d1a07a'],
  hairColor: [
    '#090806',
    '#2c222b',
    '#3b3024',
    '#6a4e42',
    '#a7856a',
    '#dcd0ba',
    '#e6cea8',
    '#b55239',
    '#8d4a43',
  ],
  eyeColor: ['#ffffff', '#fdfdf5', '#f7f3e8'],
  pupilColor: ['#000000', '#1b1b1b', '#3d2314', '#2b4f81', '#3b6e3a'],
  toothColor: ['#ffffff', '#fffbe8', '#f4ecd0', '#ece3c0'],
}

function pick<T>(values: readonly T[]): T {
  return values[randomInt(values.length)]
}

export function randomAvatar(): Avatar {
  return {
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

export const colorPattern = /^#[0-9a-f]{6}$/

// What <input type="color"> sends: #rrggbb, always lower case (upper case is accepted too).
const color = (label: string) =>
  z
    .string(`${label} is required`)
    .trim()
    .toLowerCase()
    .regex(colorPattern, `${label} must be a colour like #a1b2c3`)

export const avatarSchema = z.object({
  skin: color('Skin colour'),
  hairType: z.enum(hairTypes, 'Pick a hair type'),
  hairColor: color('Hair colour'),
  eyeType: z.enum(eyeTypes, 'Pick an eye type'),
  eyeColor: color('Eye colour'),
  pupilColor: color('Pupil colour'),
  toothType: z.enum(toothTypes, 'Pick a tooth type'),
  toothColor: color('Tooth colour'),
})

// For text representations, e.g. "skin #f1c27d, flat #2c222b hair, ...".
export function describeAvatar(avatar: Avatar): string {
  return [
    `skin ${avatar.skin}`,
    `${avatarLabels[avatar.hairType]?.toLowerCase()} ${avatar.hairType === 'bald' ? 'head' : `${avatar.hairColor} hair`}`,
    `${avatarLabels[avatar.eyeType]?.toLowerCase()} ${avatar.eyeColor} eyes with ${avatar.pupilColor} pupils`,
    avatar.toothType === 'none'
      ? 'no teeth'
      : `${avatarLabels[avatar.toothType]?.toLowerCase()} (${avatar.toothColor})`,
  ].join(', ')
}
