// The background colours of the share cards (src/og.ts). A user picks one on their edit
// page (user_profiles.card_color); a link to the image can override it with ?color=<id>.
// NULL means the first, `defaultCardColor`. The red of the BLURT card is not one of them.
// A new colour needs its id added to the CHECK in db/migrations.
export const cardColors = [
  { id: 'navy', label: 'Navy', from: '#11152c', to: '#242b4a' },
  { id: 'forest', label: 'Forest', from: '#0f2a1f', to: '#1f4a37' },
  { id: 'plum', label: 'Plum', from: '#231436', to: '#4a2a6a' },
  { id: 'clay', label: 'Clay', from: '#2a1a12', to: '#5a3422' },
  { id: 'teal', label: 'Teal', from: '#0d2a2c', to: '#1c5256' },
] as const

export type CardColorId = (typeof cardColors)[number]['id']

export const defaultCardColor: CardColorId = 'navy'

export function isCardColor(value: unknown): value is CardColorId {
  return cardColors.some((color) => color.id === value)
}

export function cardColorOf(value: unknown): (typeof cardColors)[number] {
  return cardColors.find((color) => color.id === value) ?? cardColors[0]
}
