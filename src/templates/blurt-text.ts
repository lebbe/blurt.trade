import { h, type ComponentChildren } from 'preact'
import htm from 'htm'
import { normalizedWebUrl } from '../limits.ts'

const html = htm.bind(h)
const tokens = /\[([^\]\n]*)\]\(([^)\n]*)\)|https?:\/\/[^\s<>"']+/gi
const safeLinkAttributes = {
  rel: 'noreferrer noopener nofollow ugc',
  referrerpolicy: 'no-referrer',
}

type BlurtToken = { text: string; url: string; markdown: boolean } | string

function tokenize(text: string): BlurtToken[] {
  const result: BlurtToken[] = []
  let start = 0
  for (const match of text.matchAll(tokens)) {
    const source = match[0]
    const index = match.index
    if (index > start) {
      result.push(text.slice(start, index))
    }
    const label = match[1]
    if (label !== undefined) {
      const url = normalizedWebUrl(match[2] ?? '')
      result.push(url ? { text: label, url, markdown: true } : source)
    } else {
      const [candidate, suffix] = trimUrlPunctuation(source)
      const url = normalizedWebUrl(candidate)
      result.push(url ? { text: url, url, markdown: false } : candidate)
      if (suffix) {
        result.push(suffix)
      }
    }
    start = index + source.length
  }
  if (start < text.length) {
    result.push(text.slice(start))
  }
  return result
}

function trimUrlPunctuation(value: string): [string, string] {
  let end = value.length
  while (end > 0 && /[.,!?;:]/.test(value[end - 1] ?? '')) {
    end--
  }
  while (
    end > 0 &&
    value[end - 1] === ')' &&
    (value.slice(0, end).match(/\)/g)?.length ?? 0) >
      (value.slice(0, end).match(/\(/g)?.length ?? 0)
  ) {
    end--
  }
  return [value.slice(0, end), value.slice(end)]
}

export function sanitizeBlurtLinks(text: string): string {
  return tokenize(text)
    .map((token) =>
      typeof token === 'string'
        ? token
        : token.markdown
          ? `[${token.text}](${token.url})`
          : token.url,
    )
    .join('')
}

export function renderBlurtText(text: string): ComponentChildren {
  return tokenize(text).map((token) => {
    if (typeof token === 'string') {
      return token
    }
    const link = html`<a href=${token.url} ...${safeLinkAttributes}>${token.text}</a>`
    return token.markdown ? [link, ` (${new URL(token.url).hostname})`] : link
  })
}
