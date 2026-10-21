import { h } from 'preact'
import htm from 'htm'

const html = htm.bind(h)

// Small line icons as inline SVG, drawn in the text colour (currentColor). Inline because
// the Content-Security-Policy allows no fonts or third-party files (an icon font would be
// both), and inline SVG markup needs no policy. Each is a 24 x 24 box of stroked paths.

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
}

const paths = {
  home: ['M3 11 12 3l9 8', 'M5 9.5V20h14V9.5', 'M10 20v-6h4v6'],
  globe: [circle(12, 12, 9), 'M3 12h18', 'M12 3c-3 3-4 6-4 9s1 6 4 9c3-3 4-6 4-9s-1-6-4-9'],
  search: [circle(11, 11, 7), 'm16.5 16.5 4.5 4.5'],
  pin: ['M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z', circle(12, 10, 2.5)],
  person: [circle(12, 8, 4), 'M4 21c0-4.5 3.6-7 8-7s8 2.5 8 7'],
  personPlus: [circle(10, 8, 4), 'M2 21c0-4.5 3.6-7 8-7 2 0 3.8.5 5.2 1.5', 'M19 14v6', 'M16 17h6'],
  personMinus: [circle(10, 8, 4), 'M2 21c0-4.5 3.6-7 8-7 2 0 3.8.5 5.2 1.5', 'M16 17h6'],
  sliders: [
    'M4 6h9',
    'M19 6h1',
    circle(16, 6, 2.5),
    'M4 12h2',
    'M12 12h8',
    circle(9, 12, 2.5),
    'M4 18h11',
    circle(17.5, 18, 2.5),
  ],
  megaphone: ['M3 10v4h3l9 5V5l-9 5z', 'M6 14l1.5 6h3L9 15.5', 'M18 9.5a3.5 3.5 0 0 1 0 5'],
  reply: ['M9 6 4 11l5 5', 'M4 11h10a6 6 0 0 1 6 6v2'],
  reblurt: [
    'm17 2 3 3-3 3',
    'M4 11V9a4 4 0 0 1 4-4h12',
    'm7 22-3-3 3-3',
    'M20 13v2a4 4 0 0 1-4 4H4',
  ],
  heart: ['M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z'],
  quote: ['M4 5h16v11H10l-5 4v-4H4z', 'M9 9v3', 'M15 9v3'],
  thread: ['M4 5h16v11H10l-5 4v-4H4z', 'M8 9h8', 'M8 12h5'],
  flag: ['M5 21V4', 'M5 4h12l-2.5 4.5L17 13H5'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'm13 7 4 4'],
  logout: ['M14 4h5v16h-5', 'M9 8l-4 4 4 4', 'M5 12h11'],
  login: ['M14 4h5v16h-5', 'M10 8l4 4-4 4', 'M3 12h11'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  warning: ['M12 3 2 21h20z', 'M12 10v5', 'M12 18v.5'],
  back: ['M10 6l-6 6 6 6', 'M4 12h16'],
  palette: [
    'M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.5-4-8-9-8z',
    circle(7.5, 11, 1),
    circle(10, 7, 1),
    circle(15, 7, 1),
  ],
  share: [
    circle(6, 12, 2.5),
    circle(18, 6, 2.5),
    circle(18, 18, 2.5),
    'M8.3 10.8l7.4-3.6',
    'M8.3 13.2l7.4 3.6',
  ],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  save: ['M5 4h11l3 3v13H5z', 'M8 4v5h7V4', 'M8 20v-6h8v6'],
  hourglass: [
    'M6 3h12',
    'M6 21h12',
    'M7 3c0 5 10 5 10 9s-10 4-10 9',
    'M17 3c0 5-10 5-10 9s10 4 10 9',
  ],
} as const

export type IconName = keyof typeof paths

// Decorative: always next to text that says the same, so hidden from screen readers.
export function Icon({ name }: { name: IconName }) {
  return html`<svg
    class="icon"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    ${paths[name].map((d) => html`<path d=${d} />`)}
  </svg>`
}
