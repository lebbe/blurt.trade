import { h } from 'preact'
import htm from 'htm'

// The tagged template every component is written in: htm turns it into Preact elements,
// with no build step, on the server today and in the browser later.
//
// The cast is for TypeScript only: htm's package has no "type": "module", so under
// "module": "nodenext" its typings read as CommonJS and the default import looks like the
// whole module. Node loads htm's ESM build (dist/htm.mjs), whose default export is htm.
export const html = (htm as unknown as typeof htm.default).bind(h)
