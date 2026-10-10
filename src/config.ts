import { pathToFileURL } from 'node:url'

// Checks the environment before the server starts, so a typo or a missing variable stops
// the deploy instead of quietly falling back to a development default (the local database,
// no proxy, a pool of 20). Every variable is described in docs/deploy.md, Environment.
//
// Errors stop the server; warnings are logged. Run it on its own to check an env file:
//   node --env-file=/etc/blurt/blurt.env src/config.ts
//
// Some variables are also checked where they're read, at import: JWT_SECRET
// (src/middleware/auth.ts) and RATE_LIMIT_* (src/middleware/rate-limit.ts).

export type ConfigProblems = { errors: string[]; warnings: string[] }

type Env = Record<string, string | undefined>

export function configProblems(env: Env = process.env): ConfigProblems {
  const errors: string[] = []
  const warnings: string[] = []
  const production = env.NODE_ENV === 'production'
  const set = (name: string) => env[name] !== undefined && env[name] !== ''

  const integer = (name: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
    if (!set(name)) {
      return
    }
    const value = Number(env[name])
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${name} must be a whole number from ${min} to ${max}, not "${env[name]}"`)
    }
  }
  integer('PORT', 0, 65535)
  integer('DB_POOL_SIZE', 1, 1000)
  integer('READ_YOUR_WRITES_SECONDS', 1)
  integer('ALERT_5XX_THRESHOLD', 1)

  // Not echoed: the webhook URL usually holds a token.
  if (set('ALERT_WEBHOOK_URL') && !/^https?:\/\/\S+$/.test(env.ALERT_WEBHOOK_URL as string)) {
    errors.push('ALERT_WEBHOOK_URL must be an http(s):// URL')
  }

  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'DATABASE_READ_URL']) {
    if (set(name) && !/^postgres(ql)?:\/\//.test(env[name] as string)) {
      errors.push(`${name} must be a postgres:// URL`)
    }
  }

  if (set('CONTACT_EMAIL') && !emailPattern.test(env.CONTACT_EMAIL as string)) {
    errors.push(`CONTACT_EMAIL must be an email address, not "${env.CONTACT_EMAIL}"`)
  }
  if (set('CONTACT_REPO_URL') && !repoUrlPattern.test(env.CONTACT_REPO_URL as string)) {
    errors.push(
      `CONTACT_REPO_URL must be a GitHub repository, https://github.com/<owner>/<repo>, not "${env.CONTACT_REPO_URL}"`,
    )
  }

  if (set('MIGRATE_ON_START') && !['true', 'false'].includes(env.MIGRATE_ON_START as string)) {
    errors.push('MIGRATE_ON_START must be true or false')
  }

  if (production) {
    if ((env.JWT_SECRET ?? '').length < 32) {
      errors.push('Set JWT_SECRET to at least 32 random characters: openssl rand -base64 48')
    }
    if (!set('DATABASE_URL')) {
      // Otherwise the app would connect to the local development database.
      errors.push('Set DATABASE_URL')
    }
    if (!set('TRUST_PROXY')) {
      // Behind a proxy, every client would share the proxy's address, and so one set of
      // rate-limit buckets. Running without a proxy has to be said out loud.
      errors.push('Set TRUST_PROXY: 1 behind one reverse proxy, or false without one')
    }
    if (set('DATABASE_URL') && !set('MIGRATION_DATABASE_URL') && env.MIGRATE_ON_START !== 'false') {
      warnings.push(
        'MIGRATION_DATABASE_URL is not set, so migrations use DATABASE_URL. If that is ' +
          'PgBouncer in transaction mode, point MIGRATION_DATABASE_URL at PostgreSQL itself',
      )
    }
    if (!set('ALERT_WEBHOOK_URL')) {
      warnings.push(
        'ALERT_WEBHOOK_URL is not set, so crashes and 5xx spikes only show in the log ' +
          '(docs/deploy.md, Logs and monitoring)',
      )
    }
    if (!set('CONTACT_EMAIL') && !set('CONTACT_REPO_URL')) {
      warnings.push(
        'Neither CONTACT_EMAIL nor CONTACT_REPO_URL is set, so /about gives no way to reach you',
      )
    }
    if (env.RATE_LIMIT_SCALE !== undefined && Number(env.RATE_LIMIT_SCALE) === 0) {
      warnings.push('RATE_LIMIT_SCALE=0 switches rate limiting off')
    }
  }

  return { errors, warnings }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const repoUrlPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/

// How to reach whoever runs the site, shown on /about, /terms and /privacy. Both parts are
// optional and public. CONTACT_REPO_URL gives the public issue tracker and GitHub's
// private vulnerability reports; CONTACT_EMAIL is for anything that shouldn't be public.
// Read per request, so it follows the environment (and tests can set it).
export type Contact = {
  email: string | null
  issuesUrl: string | null
  securityUrl: string | null
}

export function contact(env: Env = process.env): Contact {
  const email = env.CONTACT_EMAIL && emailPattern.test(env.CONTACT_EMAIL) ? env.CONTACT_EMAIL : null
  const repo =
    env.CONTACT_REPO_URL && repoUrlPattern.test(env.CONTACT_REPO_URL) ? env.CONTACT_REPO_URL : null
  return {
    email,
    issuesUrl: repo && `${repo}/issues`,
    securityUrl: repo && `${repo}/security/advisories/new`,
  }
}

// Logs warnings, and throws with every error at once.
export function checkConfig(env: Env = process.env): void {
  const { errors, warnings } = configProblems(env)
  for (const warning of warnings) {
    console.warn(`Config warning: ${warning}`)
  }
  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  ${errors.join('\n  ')}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkConfig()
    console.log('Configuration is valid')
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
