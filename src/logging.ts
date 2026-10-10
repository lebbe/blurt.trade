import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

// Structured logs: one JSON object per line on stdout (info) or stderr (warn, error),
// which systemd hands to journald (docs/deploy.md, Logs and monitoring).
//
// Privacy: request lines hold the method, the path without its query string, the status,
// the duration and a request id. Never IP addresses, headers (so no cookies or tokens),
// query strings or bodies (so no passwords). The IP stays out on purpose: rate limiting
// needs it only in memory, and Caddy's access log keeps a truncated one
// (deploy/Caddyfile). Errors log their stack, which holds code locations, not input.

export type LogLevel = 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>

type Sink = (level: LogLevel, line: string) => void

const defaultSink: Sink = (level, line) => {
  ;(level === 'info' ? process.stdout : process.stderr).write(`${line}\n`)
}
let sink: Sink = defaultSink

// For tests: collect lines instead of writing them. No argument restores stdout/stderr.
export function setLogSink(newSink?: Sink): void {
  sink = newSink ?? defaultSink
}

export function log(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const entry: LogFields = { time: new Date().toISOString(), level, msg }
  for (const [key, value] of Object.entries(fields)) {
    entry[key] = value instanceof Error ? errorFields(value) : value
  }
  sink(level, JSON.stringify(entry))
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

// --- Alerts -------------------------------------------------------------------------------

// Optional: ALERT_WEBHOOK_URL gets a POST with {"text": "..."} (Slack, Mattermost, Google
// Chat, or an ntfy topic, which shows the body) when the process crashes and when 5xx
// responses spike. Down-time itself is caught by an external uptime check on /healthz.
const alertTimeoutMs = 5000

export async function sendAlert(text: string, env = process.env): Promise<void> {
  const url = env.ALERT_WEBHOOK_URL
  if (!url) {
    return
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `blurt.trade: ${text}` }),
      signal: AbortSignal.timeout(alertTimeoutMs),
    })
    if (!response.ok) {
      log('warn', 'alert failed', { status: response.status })
    }
  } catch (error) {
    // The message only: the URL is a secret.
    log('warn', 'alert failed', { error: errorFields(error).message })
  }
}

// At most one alert per window, when the window has seen `threshold` 5xx responses.
export const serverErrorWindowMs = 5 * 60 * 1000

export function serverErrorThreshold(env = process.env): number {
  return Number(env.ALERT_5XX_THRESHOLD) || 10
}

let windowStart = 0
let windowCount = 0
let windowAlerted = false

// Returns true when this 5xx crosses the threshold (and an alert goes out).
export function countServerError(now = Date.now(), threshold = serverErrorThreshold()): boolean {
  if (now - windowStart >= serverErrorWindowMs) {
    windowStart = now
    windowCount = 0
    windowAlerted = false
  }
  windowCount += 1
  if (windowCount >= threshold && !windowAlerted) {
    windowAlerted = true
    log('error', '5xx spike', { count: windowCount, windowMinutes: serverErrorWindowMs / 60000 })
    void sendAlert(
      `${windowCount} server errors (5xx) within ${serverErrorWindowMs / 60000} minutes`,
    )
    return true
  }
  return false
}

export function resetServerErrorCount(): void {
  windowStart = 0
  windowCount = 0
  windowAlerted = false
}

// --- Request logging ----------------------------------------------------------------------

export function requestId(response: Response): string | undefined {
  return response.locals.requestId as string | undefined
}

const maxPathLength = 200

// Paths that are not logged when they succeed: the uptime check would drown the rest.
const quietPaths = new Set(['/healthz'])

// First middleware: gives the request an id (also sent as X-Request-Id, and shown on the
// 500 page so a user can quote it) and logs one line when the response is finished.
export function requestLogger(request: Request, response: Response, next: NextFunction): void {
  const started = process.hrtime.bigint()
  const id = randomUUID()
  response.locals.requestId = id
  response.set('X-Request-Id', id)
  response.on('finish', () => {
    const path = request.originalUrl.split('?', 1)[0].slice(0, maxPathLength)
    const status = response.statusCode
    if (status >= 500) {
      countServerError()
    }
    if (status < 400 && quietPaths.has(path)) {
      return
    }
    log(status >= 500 ? 'error' : 'info', 'request', {
      id,
      method: request.method,
      path,
      status,
      ms: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100,
    })
  })
  next()
}

// Last error handler: anything a route threw that isn't a client error. Logs the stack
// with the request id; the user gets a generic 500 that says nothing about the cause.
export function serverErrorHandler(
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const id = requestId(response)
  log('error', 'unhandled error', { id, error: errorFields(error) })
  if (response.headersSent) {
    // Too late for a 500 page; Express closes the connection.
    next(error)
    return
  }
  const message = `Something went wrong on our side. If it keeps happening, mention request id ${id}.`
  response.vary('Accept').status(500).set('Cache-Control', 'no-store')
  if (request.accepts(['html', 'json']) === 'json') {
    response.type('json').send(JSON.stringify({ error: message, requestId: id }))
  } else {
    response.type('text').send(message)
  }
}

// --- Crashes ------------------------------------------------------------------------------

// Logs an uncaught exception or unhandled rejection, alerts, and exits; systemd restarts
// the process (Restart=always).
export function handleCrashes(): void {
  let crashed = false
  const crash = (kind: string) => (error: unknown) => {
    log('error', kind, { error: errorFields(error) })
    if (crashed) {
      return // already alerting and on the way out
    }
    crashed = true
    sendAlert(`crashed (${kind}): ${errorFields(error).message}`).finally(() => process.exit(1))
    setTimeout(() => process.exit(1), alertTimeoutMs + 1000).unref()
  }
  process.on('uncaughtException', crash('uncaught exception'))
  process.on('unhandledRejection', crash('unhandled rejection'))
}
