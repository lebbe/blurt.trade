import { AsyncLocalStorage } from 'node:async_hooks'
import { outsidePageContext, type PageContext } from './ui/context.ts'

export type { PageContext } from './ui/context.ts'

// The page context (see src/ui/context.ts) of the request being handled. Set once per
// request by the pageContext middleware (src/server.ts), so routes and error handlers can
// render pages without passing it along: renderDocument hands it to the components through
// a Preact context, and the Markdown views read it here.
const storage = new AsyncLocalStorage<PageContext>()

export function runWithPageContext<T>(context: PageContext, callback: () => T): T {
  return storage.run(context, callback)
}

export function pageContext(): PageContext {
  return storage.getStore() ?? outsidePageContext
}
