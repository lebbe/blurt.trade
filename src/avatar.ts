import { randomInt } from 'node:crypto'
import { z } from 'zod'

// The profile avatar: a cut-out cartoon face whose whole top half flaps up and down to talk.
// It is never an uploaded image, only these few choices, stored as JSON on the profile
// (user_profiles.avatar) and drawn as inline SVG by src/templates/avatar.ts. Colours are
// any #rrggbb (an <input type="color">); the types are fixed lists.
export const hairTypes = ['bald', 'tuft', 'flat', 'spiky', 'mohawk', 'afro'] as const
export const eyeTypes = ['classic', 'dots', 'round', 'wide', 'sleepy', 'angry'] as const
export const toothTypes = ['none', 'two', 'buck', 'gap', 'full'] as const
export const headWidths = ['thin', 'slim', 'regular', 'broad', 'huge'] as const

export type HairType = (typeof hairTypes)[number]
export type EyeType = (typeof eyeTypes)[number]
export type ToothType = (typeof toothTypes)[number]
export type HeadWidth = (typeof headWidths)[number]

// An uploaded profile picture, which replaces the cartoon wherever the avatar is shown
// (src/templates/avatar.ts, AvatarView). Never stored in the avatar JSON: the queries add
// it (avatarColumn in src/routes/state.ts). `cut` is where the mouth is, in percent from
// the top; `version` changes with every upload.
export type AvatarPhoto = { user: number; version: number; cut: number }

export type Avatar = {
  photo?: AvatarPhoto | null
  headWidth: HeadWidth
  skin: string
  hairType: HairType
  hairColor: string
  eyeType: EyeType
  eyeColor: string
  pupilColor: string
  toothType: ToothType
  toothColor: string
}

export const avatarLabels: Record<HairType | EyeType | ToothType | HeadWidth, string> = {
  thin: 'Thin',
  slim: 'Slim',
  regular: 'Regular',
  broad: 'Broad',
  huge: 'Huge',
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

export const colorPattern = /^#[0-9a-f]{6}$/

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

// Where the mouth of a profile picture may be, in percent from the top. The table's
// CHECK on user_profiles.picture_cut repeats it; 65 is the default there too.
export const minPictureCut = 5
export const maxPictureCut = 95
export const defaultPictureCut = 65

// The size the edit page shows the whole profile picture at, as <input type="image">: a
// click on it sends `cut.x` and `cut.y` in these pixels (src/routes/profile-picture.ts).
export const cutImageSize = 240

// The top half of a profile picture reaches this far (in its 640 px) below the cut, under
// nothing: the jaw is pulled up by as much (public/style.css, -1.25% = 8 / 640), so no
// seam shows between the two images.
export const photoOverlap = 8

export type PicturePart = 'top' | 'jaw' | 'edit'

// The URL of a part of a profile picture (src/routes/profile-picture.ts): `top` and `jaw`,
// the two halves that talk, or `edit`, the whole picture with the cut drawn on it. The
// version and cut are in it, so each URL always gives the same SVG.
export function photoUrl(photo: AvatarPhoto, part: PicturePart): string {
  return `/profile-pictures/${photo.user}-${photo.version}-${photo.cut}-${part}.svg`
}

// For text representations, e.g. "regular head, skin #f1c27d, flat #2c222b hair, ...".
export function describeAvatar(avatar: Avatar): string {
  if (avatar.photo) {
    return `a profile picture (${photoUrl(avatar.photo, 'top')} over ${photoUrl(avatar.photo, 'jaw')}, cut ${avatar.photo.cut}% from the top)`
  }
  return [
    `${avatarLabels[avatar.headWidth]?.toLowerCase() ?? 'regular'} head`,
    `skin ${avatar.skin}`,
    `${avatarLabels[avatar.hairType]?.toLowerCase()} ${avatar.hairType === 'bald' ? 'head' : `${avatar.hairColor} hair`}`,
    `${avatarLabels[avatar.eyeType]?.toLowerCase()} ${avatar.eyeColor} eyes with ${avatar.pupilColor} pupils`,
    avatar.toothType === 'none'
      ? 'no teeth'
      : `${avatarLabels[avatar.toothType]?.toLowerCase()} (${avatar.toothColor})`,
  ].join(', ')
}
