// Small text helpers the components share.

// Text for a title or description: whitespace collapsed, at most `max` characters (code
// points, so an emoji is never cut in half), with an ellipsis when cut.
export function preview(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  return chars.length <= max
    ? chars.join('')
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
