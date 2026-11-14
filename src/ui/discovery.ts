import type { Blurt } from '../routes/state/blurts.ts'
import { BlurtCard } from './blurt-card.ts'
import type { Viewer } from './context.ts'
import { html } from './html.ts'

// Where a discovery section's blurts come from: 'similar' are close in meaning to what the
// viewer has blurted lately, 'nearby' from people whose location is near theirs.
export type DiscoveryKind = 'similar' | 'nearby'

export const discoveryTitles: Record<DiscoveryKind, { title: string; description: string }> = {
  similar: { title: 'You might like', description: "Close to what you've blurted lately." },
  nearby: { title: 'Near you', description: 'From people near where you are.' },
}

// Blurts from outside the feed, shown after the first `after` of its `blurts`.
export type DiscoverySection = { kind: DiscoveryKind; after: number; blurts: Blurt[] }

// The discovery sections that go after the feed's first `count` blurts.
export function discoveryAfter(discovery: DiscoverySection[], count: number): DiscoverySection[] {
  return discovery.filter((section) => section.after === count)
}

export function Discovery({ section, viewer }: { section: DiscoverySection; viewer: Viewer }) {
  const { title, description } = discoveryTitles[section.kind]
  return html`
    <section aria-label=${title} class="discovery">
      <h2>${title}</h2>
      <p class="discovery-description">${description}</p>
      ${section.blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} />`)}
    </section>
  `
}
