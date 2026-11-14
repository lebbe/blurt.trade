import { enhanceAll, type Registry } from './enhance.ts'
import { readPageContext } from './page-context.ts'

// The one script every page with JavaScript on loads (src/pages/shared/layout.ts). JavaScript
// is progressive enhancement here: every page works without it, and each enhancer only
// makes an element that already works a little nicer.
//
// An element asks for an enhancer by name, `<form data-enhance="autosave">` (several
// names separated by spaces). Each enhancer is its own module, loaded with import() only
// on pages that have such an element. To add one: write src/client/<name>.ts exporting
// `enhance(element, context)` (see Enhancer in ./enhance.ts) and add a line here. The
// import() must be a literal relative path, so it resolves under this module's versioned
// URL (src/client-modules.ts).
const enhancers: Registry = {
  autosave: () => import('./autosave.ts'),
  map: () => import('./map.ts'),
  mouth: () => import('./mouth.ts'),
}

// Set only once this script actually runs: CSS that hides a fallback (a save button that
// autosave replaces, say) must key on [data-js=on], not on `scripting: enabled`, or a
// script that fails to load would leave the page without the fallback.
document.documentElement.dataset.js = 'on'

void enhanceAll(document, enhancers, { page: readPageContext() })
