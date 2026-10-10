import { h } from 'preact'
import htm from 'htm'
import { colorPattern, eyeTypes, hairTypes, toothTypes, type Avatar } from '../avatar.ts'

const html = htm.bind(h)

// The avatar as inline SVG, in a 100 x 100 box: a wide cartoon head cut in two along the
// mouth. Only built from the avatar's fields, never from stored markup, and every value is
// checked again here (a colour that isn't #rrggbb, or an unknown type, gets a default),
// so nothing from the database can add elements, scripts or links.
//
// Talking is CSS only (in public/style.css): on hover over the avatar or
// its blurt, the two `avatar-top` groups (the upper teeth and the top of the head) flap up
// and down around a hinge at the back of the head, showing the dark mouth behind them.
// Drawing order makes that work without clip paths:
//   1. the mouth: a dark copy of the top of the head, in place (shows wherever it lifts)
//   2. the lower teeth
//   3. the upper teeth (moving), hanging below the cut, so hidden behind...
//   4. the jaw, while the mouth is shut
//   5. the top of the head (moving): hair, skin, eyes

const outline = '#1a1410'
const mouthColor = '#3a0d12'
const cut = 58 // y of the mouth line

const domePath = `M10 ${cut} C10 28 28 10 50 10 C72 10 90 28 90 ${cut} Z`
const jawPath = `M10 ${cut} H90 C90 80 74 92 50 92 C26 92 10 80 10 ${cut} Z`

function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && colorPattern.test(value) ? value : fallback
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T {
  return values.includes(value as T) ? (value as T) : values[0]
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

const eyeX = [35, 65]
const eyeY = 38

function Eyes({
  type,
  white,
  pupil,
  skin,
}: {
  type: string
  white: string
  pupil: string
  skin: string
}) {
  return eyeX.map((x) => {
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
}: {
  avatar: Avatar
  label?: string // without one, the avatar is decoration (aria-hidden)
  size?: 'small' | 'large'
}) {
  const skin = safeColor(avatar?.skin, '#f1c27d')
  const hairType = oneOf(hairTypes, avatar?.hairType)
  const hairColor = safeColor(avatar?.hairColor, '#2c222b')
  const eyeType = oneOf(eyeTypes, avatar?.eyeType)
  const eyeColor = safeColor(avatar?.eyeColor, '#ffffff')
  const pupilColor = safeColor(avatar?.pupilColor, '#000000')
  const toothType = oneOf(toothTypes, avatar?.toothType)
  const toothColor = safeColor(avatar?.toothColor, '#ffffff')

  return html`<svg
    class="avatar avatar-${size}"
    viewBox="0 0 100 100"
    xmlns="http://www.w3.org/2000/svg"
    role=${label ? 'img' : undefined}
    aria-label=${label}
    aria-hidden=${label ? undefined : 'true'}
    focusable="false"
  >
    <path d=${domePath} fill=${mouthColor} />
    <${LowerTeeth} type=${toothType} color=${toothColor} />
    <g class="avatar-top"><${UpperTeeth} type=${toothType} color=${toothColor} /></g>
    <path d=${jawPath} fill=${skin} ...${stroke} />
    <g class="avatar-top">
      <${HairBack} type=${hairType} color=${hairColor} />
      <path d=${domePath} fill=${skin} ...${stroke} />
      <${HairFront} type=${hairType} color=${hairColor} />
      <${Eyes} type=${eyeType} white=${eyeColor} pupil=${pupilColor} skin=${skin} />
    </g>
  </svg>`
}
