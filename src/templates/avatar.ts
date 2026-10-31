import { h } from 'preact'
import htm from 'htm'
import {
  maxPictureCut,
  minPictureCut,
  photoOverlap,
  photoUrl,
  colorPattern,
  eyeTypes,
  hairTypes,
  headWidths,
  toothTypes,
  type Avatar,
  type AvatarPhoto,
  type HeadWidth,
} from '../avatar.ts'

const html = htm.bind(h)

// The avatar as inline SVG, in a 100 x 100 box: a wide cartoon head cut in two along the
// mouth. Only built from the avatar's fields, never from stored markup, and every value is
// checked again here (a colour that isn't #rrggbb, or an unknown type, gets a default),
// so nothing from the database can add elements, scripts or links.
//
// Talking is CSS only (in public/style.css): on hover over the avatar or
// its blurt, the two `avatar-top` groups (the upper teeth and the top of the head) flap up
// and down around a hinge at the back of the head (on the right), showing the dark mouth
// behind them, and the `avatar-jaw` group (the jaw and the lower teeth) bobs along.
// Drawing order makes that work without clip paths:
//   1. the mouth: a dark copy of the top of the head, reaching a little below the cut
//      (shows wherever the top lifts or the jaw drops)
//   2. the lower teeth (moving with the jaw)
//   3. the upper teeth (moving), hanging below the cut, so hidden behind...
//   4. the jaw (moving), while the mouth is shut
//   5. the top of the head (moving): hair, skin, eyes
//
// `openMouth` is a still of the biggest flap (33% of `avatar-talk` in
// public/style.css). Keep its transforms in sync with that keyframe.
//
// The head width stretches all of that sideways around the middle (a transform on one
// group, so the hinge in the CSS moves with it), except the eyes, which keep their shape
// and only move apart. Heads wider than the box get a bigger viewBox.

const outline = '#1a1410'
const mouthColor = '#3a0d12'
const cut = 58 // y of the mouth line

const domePath = `M10 ${cut} C10 28 28 10 50 10 C72 10 90 28 90 ${cut} Z`
const mouthPath = `M10 ${cut} C10 28 28 10 50 10 C72 10 90 28 90 ${cut} V${cut + 6} H10 Z`
const jawPath = `M10 ${cut} H90 C90 80 74 92 50 92 C26 92 10 80 10 ${cut} Z`

function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && colorPattern.test(value) ? value : fallback
}

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback = values[0]): T {
  return values.includes(value as T) ? (value as T) : fallback
}

// Two decimals are plenty in a 100-wide box, and keep the markup short.
function round(value: number): number {
  return Math.round(value * 100) / 100
}

// How much each head width stretches the head sideways.
const headScales: Record<HeadWidth, number> = {
  thin: 0.72,
  slim: 0.86,
  regular: 1,
  broad: 1.15,
  huge: 1.3,
}

const stroke = { stroke: outline, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }

// Drawn behind the head (only the afro, which frames it).
function HairBack({ type, color }: { type: string; color: string }) {
  return type === 'afro'
    ? html`<ellipse cx="50" cy="30" rx="44" ry="28" fill=${color} ...${stroke} />`
    : null
}

function HairFront({ type, color }: { type: string; color: string }) {
  switch (type) {
    case 'tuft':
      return html`<path
        d="M47 11 C43 3 52 1 54 7 C56 2 62 5 58 11"
        fill="none"
        stroke=${color}
        stroke-width="3"
        stroke-linecap="round"
      />`
    case 'flat':
      return html`<path
        d="M11 46 C11 22 29 9 50 9 C71 9 89 22 89 46 C80 31 66 25 50 25 C34 25 20 31 11 46 Z"
        fill=${color}
        ...${stroke}
      />`
    case 'spiky':
      return html`<path
        d="M13 42 L16 20 L25 27 L31 8 L40 21 L50 2 L60 21 L69 8 L75 27 L84 20 L87 42 C79 28 65 22 50 22 C35 22 21 28 13 42 Z"
        fill=${color}
        ...${stroke}
      />`
    case 'mohawk':
      return html`<path
        d="M44 12 L41 1 L47 5 L50 0 L53 5 L59 1 L56 12 Z"
        fill=${color}
        ...${stroke}
      />`
    default:
      return null // bald, and the afro (behind the head)
  }
}

const eyeY = 38

// `spread`: how far each eye is from the middle.
function Eyes({
  type,
  white,
  pupil,
  skin,
  spread,
}: {
  type: string
  white: string
  pupil: string
  skin: string
  spread: number
}) {
  return [50 - spread, 50 + spread].map((x) => {
    switch (type) {
      case 'dots':
        return html`<circle cx=${x} cy=${eyeY} r="3" fill=${pupil} />`
      case 'round':
        return html`<g>
          <circle cx=${x} cy=${eyeY} r="9" fill=${white} ...${stroke} />
          <circle cx=${x} cy=${eyeY} r="3.5" fill=${pupil} />
        </g>`
      case 'wide':
        return html`<g>
          <ellipse cx=${x} cy=${eyeY} rx="11" ry="7" fill=${white} ...${stroke} />
          <circle cx=${x} cy=${eyeY} r="3" fill=${pupil} />
        </g>`
      case 'sleepy':
        return html`<g>
          <ellipse cx=${x} cy=${eyeY} rx="8" ry="7" fill=${white} ...${stroke} />
          <circle cx=${x} cy=${eyeY + 3} r="2.5" fill=${pupil} />
          <path d="M${x - 9} ${eyeY} A9 8 0 0 1 ${x + 9} ${eyeY} Z" fill=${skin} ...${stroke} />
        </g>`
      case 'angry': {
        const inner = x < 50 ? 1 : -1 // brows slope down towards the nose
        return html`<g>
          <ellipse cx=${x} cy=${eyeY} rx="7" ry="8" fill=${white} ...${stroke} />
          <circle cx=${x + inner * 1.5} cy=${eyeY + 1} r="2.5" fill=${pupil} />
          <path
            d="M${x - 10 * inner} ${eyeY - 12} L${x + 9 * inner} ${eyeY - 5}"
            stroke=${outline}
            stroke-width="3"
            stroke-linecap="round"
          />
        </g>`
      }
      default: // classic: white ovals with a dot
        return html`<g>
          <ellipse cx=${x} cy=${eyeY} rx="7" ry="8.5" fill=${white} ...${stroke} />
          <circle cx=${x + (x < 50 ? 1.5 : -1.5)} cy=${eyeY + 1} r="2.5" fill=${pupil} />
        </g>`
    }
  })
}

const toothStroke = { stroke: outline, 'stroke-width': 0.8 }

// Upper teeth hang from the top half, just below the cut: hidden behind the jaw until the
// mouth opens.
function UpperTeeth({ type, color }: { type: string; color: string }) {
  const tooth = (x: number, width: number, height: number) =>
    html`<rect x=${x} y=${cut} width=${width} height=${height} fill=${color} ...${toothStroke} />`
  switch (type) {
    case 'two':
      return [tooth(42, 7.5, 7), tooth(50.5, 7.5, 7)]
    case 'buck':
      return [tooth(44, 12, 10)]
    case 'gap':
      return [tooth(35, 9, 6), tooth(56, 9, 6)]
    case 'full':
      return [26, 34, 42, 50, 58, 66].map((x) => tooth(x, 8, 4.5))
    default:
      return null
  }
}

// Lower teeth sit on the jaw, inside the mouth: covered by the top half until it lifts.
function LowerTeeth({ type, color }: { type: string; color: string }) {
  return type === 'full'
    ? [30, 38, 46, 54, 62].map(
        (x) =>
          html`<rect x=${x} y=${cut - 4} width="8" height="4" fill=${color} ...${toothStroke} />`,
      )
    : null
}

export function AvatarSvg({
  avatar,
  label,
  size = 'small',
  openMouth = false,
}: {
  avatar: Avatar
  label?: string // without one, the avatar is decoration (aria-hidden)
  size?: 'small' | 'large'
  openMouth?: boolean
}) {
  const skin = safeColor(avatar?.skin, '#f1c27d')
  const hairType = oneOf(hairTypes, avatar?.hairType)
  const hairColor = safeColor(avatar?.hairColor, '#2c222b')
  const eyeType = oneOf(eyeTypes, avatar?.eyeType)
  const eyeColor = safeColor(avatar?.eyeColor, '#ffffff')
  const pupilColor = safeColor(avatar?.pupilColor, '#000000')
  const toothType = oneOf(toothTypes, avatar?.toothType)
  const toothColor = safeColor(avatar?.toothColor, '#ffffff')
  const scale = headScales[oneOf(headWidths, avatar?.headWidth, 'regular')]

  // Square, centred on the middle of the default box, wide enough for the widest part
  // (the afro).
  const box = round(Math.max(100, 2 * (44 * scale + 1)))
  const stretch = `translate(50 0) scale(${scale} 1) translate(-50 0)`
  const unstretch = `translate(50 0) scale(${round(1 / scale)} 1) translate(-50 0)`
  const topFlap = openMouth ? 'translate(0 -4) rotate(21 86 58)' : undefined
  const jawFlop = openMouth ? 'translate(0 3)' : undefined
  const viewBox = openMouth
    ? `${round(50 - box / 2 - 24)} -32 ${box + 36} 132`
    : `${round(50 - box / 2)} ${round(50 - box / 2)} ${box} ${box}`

  return html`<svg
    class="avatar avatar-${size}"
    viewBox=${viewBox}
    xmlns="http://www.w3.org/2000/svg"
    role=${label ? 'img' : undefined}
    aria-label=${label}
    aria-hidden=${label ? undefined : 'true'}
    focusable="false"
  >
    <g transform=${scale === 1 ? undefined : stretch}>
      <path d=${mouthPath} fill=${mouthColor} />
      <g class="avatar-jaw" transform=${jawFlop}>
        <${LowerTeeth} type=${toothType} color=${toothColor} />
      </g>
      <g class="avatar-top" transform=${topFlap}>
        <${UpperTeeth} type=${toothType} color=${toothColor} />
      </g>
      <g class="avatar-jaw" transform=${jawFlop}><path d=${jawPath} fill=${skin} ...${stroke} /></g>
      <g class="avatar-top" transform=${topFlap}>
        <${HairBack} type=${hairType} color=${hairColor} />
        <path d=${domePath} fill=${skin} ...${stroke} />
        <${HairFront} type=${hairType} color=${hairColor} />
        <g transform=${scale === 1 ? undefined : unstretch}>
          <${Eyes}
            type=${eyeType}
            white=${eyeColor}
            pupil=${pupilColor}
            skin=${skin}
            spread=${round(15 * Math.sqrt(scale))}
          />
        </g>
      </g>
    </g>
  </svg>`
}

// The size profile pictures are drawn at (src/picture.ts, square).
const photoSize = 640

// A photo, if it is a well-formed one: numbers only, so nothing else gets into its URLs.
function safePhoto(photo: unknown): AvatarPhoto | undefined {
  const { user, version, cut } = (photo ?? {}) as Partial<AvatarPhoto>
  return Number.isSafeInteger(user) &&
    Number.isSafeInteger(version) &&
    Number.isInteger(cut) &&
    cut! >= minPictureCut &&
    cut! <= maxPictureCut
    ? { user: user!, version: version!, cut: cut! }
    : undefined
}

// A profile picture that talks like the cartoon: two empty <img>s stacked, the part above
// the mouth (`avatar-top`) and the part below (`avatar-jaw`), each an SVG of just that
// band (src/routes/profile-picture.ts). Their width and height give each its share of the
// square (the top one a little more, photoOverlap, tucked over the jaw), so no inline
// style is needed (the CSP allows none). On hover the same CSS as the
// cartoon's flaps the top up around the back of the head and bobs the jaw, showing the
// dark mouth behind them (public/style.css, .avatar-photo).
function AvatarPhotoView({
  photo,
  label,
  size,
}: {
  photo: AvatarPhoto
  label?: string
  size: 'small' | 'large'
}) {
  const line = Math.round((photoSize * photo.cut) / 100)
  return html`<span
    class="avatar avatar-${size} avatar-photo"
    role=${label ? 'img' : undefined}
    aria-label=${label}
    aria-hidden=${label ? undefined : 'true'}
    ><span class="avatar-mouth"
      ><img
        class="avatar-top"
        src=${photoUrl(photo, 'top')}
        width=${photoSize}
        height=${line + photoOverlap}
        alt=""
        decoding="async" /><img
        class="avatar-jaw"
        src=${photoUrl(photo, 'jaw')}
        width=${photoSize}
        height=${photoSize - line}
        alt=""
        decoding="async" /></span
  ></span>`
}

// The avatar as shown everywhere: the profile picture when there is one, otherwise the
// cartoon (AvatarSvg).
export function AvatarView(props: {
  avatar: Avatar | null
  label?: string
  size?: 'small' | 'large'
}) {
  const photo = safePhoto(props.avatar?.photo)
  return photo
    ? html`<${AvatarPhotoView} photo=${photo} label=${props.label} size=${props.size ?? 'small'} />`
    : html`<${AvatarSvg}
        avatar=${props.avatar as Avatar}
        label=${props.label}
        size=${props.size}
      />`
}
