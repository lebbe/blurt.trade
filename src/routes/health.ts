import { Router } from 'express'
import { db, dbRead } from '../db.ts'
import { errorFields, log } from '../logging.ts'

export const healthRouter = Router()

const checkTimeoutMs = 3000

async function ping(query: () => Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      query(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), checkTimeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// For the external uptime check and the deploy script: 200 "ok" when the app answers and
// the database (and the read replica, if there is one) runs a query, 503 otherwise. Plain
// text, no auth, no details beyond which database failed; the cause goes to the log.
healthRouter.get('/healthz', async (_request, response) => {
  response.set('Cache-Control', 'no-store').type('text')
  const checks: [string, () => Promise<unknown>][] = [['database', () => db().query('SELECT 1')]]
  if (process.env.DATABASE_READ_URL) {
    checks.push(['read replica', () => dbRead().query('SELECT 1')])
  }
  for (const [name, query] of checks) {
    try {
      await ping(query)
    } catch (error) {
      log('error', 'health check failed', { check: name, error: errorFields(error).message })
      response.status(503).send(`${name} unavailable\n`)
      return
    }
  }
  response.send('ok\n')
})
