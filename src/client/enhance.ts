import type { PageContext } from '../ui/context.ts'

// What every enhancer gets besides its element.
export type EnhancerContext = {
  page: PageContext // the page context the server rendered the page with
}

// The module an enhancer name loads. enhance() may be async; once it resolves, the
// element is marked as enhanced. If it throws or rejects, the element keeps working
// as the server rendered it, so an enhancer must not take the original behaviour away
// (preventDefault, hidden buttons) until it is ready to replace it.
export type Enhancer = {
  enhance(element: HTMLElement, context: EnhancerContext): void | Promise<void>
}

export type Registry = Record<string, () => Promise<Enhancer>>

export type EnhanceOutcome = {
  name: string
  element: HTMLElement
  status: 'enhanced' | 'failed' | 'unknown'
  error?: unknown
}

// Elements already handed to an enhancer, by name, so calling enhanceAll again (after
// new content is inserted, e.g. the next page of a feed) never enhances one twice.
const done = new WeakMap<HTMLElement, Set<string>>()
// One import per module and registry, however many elements use it.
const loaded = new WeakMap<Registry, Map<string, Promise<Enhancer>>>()

function load(registry: Registry, name: string): Promise<Enhancer> {
  let modules = loaded.get(registry)
  if (!modules) {
    modules = new Map()
    loaded.set(registry, modules)
  }
  let module = modules.get(name)
  if (!module) {
    module = registry[name]()
    modules.set(name, module)
  }
  return module
}

// Runs the enhancer of every [data-enhance] element in `root` (itself included). Each one
// on its own: a module that fails to load, or an enhance() that throws, is logged to the
// console and affects nothing else. Resolves when all have finished, with how each went.
export async function enhanceAll(
  root: ParentNode,
  registry: Registry,
  context: EnhancerContext,
): Promise<EnhanceOutcome[]> {
  const elements = [...root.querySelectorAll<HTMLElement>('[data-enhance]')]
  if (root instanceof HTMLElement && root.matches('[data-enhance]')) {
    elements.unshift(root)
  }
  const tasks: Promise<EnhanceOutcome>[] = []
  for (const element of elements) {
    const names = (element.dataset.enhance ?? '').split(/\s+/).filter(Boolean)
    const seen = done.get(element) ?? new Set()
    done.set(element, seen)
    for (const name of names) {
      if (seen.has(name)) {
        continue
      }
      seen.add(name)
      if (!Object.hasOwn(registry, name)) {
        console.warn(`No enhancer named "${name}"`, element)
        tasks.push(Promise.resolve({ name, element, status: 'unknown' }))
        continue
      }
      tasks.push(
        (async (): Promise<EnhanceOutcome> => {
          try {
            const module = await load(registry, name)
            await module.enhance(element, context)
            element.dataset.enhanced = [element.dataset.enhanced, name].filter(Boolean).join(' ')
            return { name, element, status: 'enhanced' }
          } catch (error) {
            console.error(`Enhancer "${name}" failed`, error)
            return { name, element, status: 'failed', error }
          }
        })(),
      )
    }
  }
  return Promise.all(tasks)
}
