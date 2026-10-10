// A tagged template for Markdown, in the spirit of htm for HTML:
//
//   md`
//     # ${profile.username}
//
//     - Bio: ${profile.bio}
//     ${blurts.map((blurt) => md`> **${blurt.username}**: ${blurt.text}`)}
//   `
//
// - Interpolated strings are escaped, so user text can never inject formatting or links.
//   Markdown values (from md, raw, link, code or join) are inserted as they are.
// - The template is dedented, so it can be indented like the code around it.
// - A multi-line value continues its line's prefix: blockquote markers repeat, and lines
//   after a list item are indented to stay inside the item.
// - null, undefined and booleans render nothing, like in JSX, so `${cond && md`...`}`
//   works. A line holding nothing but empty values is dropped, and runs of blank lines
//   collapse to one.
// - Arrays render each item and separate them with a blank line (one block per item).
//   Use join() for any other separator.
//
// oxfmt formats md`...` templates as Markdown when they have no interpolations, so it may
// restyle static ones (e.g. *a* to _a_). Use raw() for static snippets.

export class Markdown {
  readonly text: string

  constructor(text: string) {
    this.text = text
  }

  toString(): string {
    return this.text
  }
}

export type MarkdownValue =
  | Markdown
  | string
  | number
  | Date
  | boolean
  | null
  | undefined
  | readonly MarkdownValue[]

// Escapes text so it renders as itself. Inline syntax is escaped anywhere; block syntax
// (headings, list markers, ...) only where it would start a line. Leading whitespace is
// dropped so a line can't turn into an indented code block.
export function escape(text: string): string {
  return text
    .replaceAll('\r', '')
    .replace(/^[ \t]+/gm, '')
    .replace(/[\\`*_[\]<>&|~]/g, '\\$&')
    .replace(/^([#+=-])/gm, '\\$1')
    .replace(/^(\d+)([.)])/gm, '$1\\$2')
}

// Trusted Markdown, inserted without escaping. Never pass user input.
export function raw(text: string): Markdown {
  return new Markdown(text)
}

// Only call with hrefs you trust (relative paths, or URLs checked with isWebUrl).
export function link(text: MarkdownValue, href: string): Markdown {
  const destination = href.replace(/[<>\s]/g, (character) => encodeURIComponent(character))
  return new Markdown(`[${render(text)}](<${destination}>)`)
}

// An inline code span. Safe for any text: the fence is longer than any backtick run inside.
export function code(text: string): Markdown {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longestRun + 1)
  const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return new Markdown(`${fence}${padding}${text.replace(/\s*\n\s*/g, ' ')}${padding}${fence}`)
}

export function join(values: readonly MarkdownValue[], separator: string): Markdown {
  return new Markdown(
    values
      .map(render)
      .filter((text) => text !== '')
      .join(separator),
  )
}

// Values are swapped for markers (a private-use character around their index) so the
// template can be dedented and split into lines before any value is rendered.
const marker = ''
const markers = /(\d+)/

export function md(strings: TemplateStringsArray, ...values: MarkdownValue[]): Markdown {
  const source = strings
    .map((string, index) => {
      const text = string ?? strings.raw[index]
      return index < values.length ? `${text}${marker}${index}${marker}` : text
    })
    .join('')

  const lines = dedent(source).flatMap((line) => {
    // Text and value indexes alternate: [text, index, text, index, text].
    const parts = line.split(markers)
    let output = parts[0] ?? ''
    let hasContent = output.trim() !== ''
    for (let part = 1; part < parts.length; part += 2) {
      const value = render(values[Number(parts[part])])
      output += continueLines(value, output) + parts[part + 1]
      hasContent ||= value !== '' || parts[part + 1]?.trim() !== ''
    }
    // A line that only held empty values disappears instead of leaving a gap.
    return parts.length > 1 && !hasContent ? [] : [output]
  })

  return new Markdown(
    lines
      .join('\n')
      .replace(/\n[ \t]*(?:\n[ \t]*)+\n/g, '\n\n')
      .trim(),
  )
}

function render(value: MarkdownValue): string {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return ''
  }
  if (value instanceof Markdown) {
    return value.text
  }
  if (Array.isArray(value)) {
    return join(value, '\n\n').text
  }
  if (value instanceof Date) {
    return escape(value.toISOString())
  }
  return escape(String(value))
}

function dedent(source: string): string[] {
  const lines = source.split('\n')
  if (lines[0]?.trim() === '') {
    lines.shift()
  }
  if (lines.at(-1)?.trim() === '') {
    lines.pop()
  }
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0)
  const indent = indents.length > 0 ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(indent))
}

// Lines after the first get the blockquote markers before the value, and list markers
// turned into spaces, so a multi-line value stays inside its quote or list item.
function continueLines(value: string, before: string): string {
  if (!value.includes('\n')) {
    return value
  }
  const [, quote = '', marker = ''] = /^([ \t>]*)((?:[-*+]|\d+[.)])[ \t]+)?/.exec(before) ?? []
  const prefix = quote + ' '.repeat(marker.length)
  return value
    .split('\n')
    .map((line, index) => (index === 0 ? line : line === '' ? prefix.trimEnd() : prefix + line))
    .join('\n')
}
