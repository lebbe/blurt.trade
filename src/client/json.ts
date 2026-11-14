// JSON has no dates: the server's Date fields (createdAt, joinedAt, lastBlurtAt…) arrive as
// ISO strings, and the components (Timestamp in src/ui/blurt-card.ts) want Dates, as on
// the server. Every field whose name ends in "At" and holds such a string becomes one.

const isoDate = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/

export function withDates<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(withDates) as T
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      key.endsWith('At') && typeof field === 'string' && isoDate.test(field)
        ? new Date(field)
        : withDates(field),
    ]),
  ) as T
}
