import type pg from 'pg'
import { randomInt } from 'node:crypto'
import { db } from '../../db.ts'

// Whether new people can sign up right now: 'open' below the soft limit, 'invite' (an
// invite code is needed) from the soft limit up to the hard limit, 'waitlist' at the hard
// limit. The limits live in the signup_counter row, so they can be raised without a deploy.
export type SignupState = 'open' | 'invite' | 'waitlist'

export async function getSignupState(): Promise<SignupState> {
  const { rows } = await db().query<{ state: SignupState }>(
    `SELECT CASE WHEN current_count < soft_limit THEN 'open'
                 WHEN current_count < hard_limit THEN 'invite'
                 ELSE 'waitlist' END AS state
     FROM signup_counter`,
  )
  return rows[0].state
}

export type SignupLimits = {
  count: number
  softLimit: number
  hardLimit: number
  state: SignupState
}

// The counter and its limits, for the admin page.
export async function getSignupLimits(): Promise<SignupLimits> {
  const { rows } = await db().query<Omit<SignupLimits, 'state'>>(
    `SELECT current_count AS count, soft_limit AS "softLimit", hard_limit AS "hardLimit"
     FROM signup_counter`,
  )
  return { ...rows[0], state: await getSignupState() }
}

// Raising or lowering the limits is all it takes: the state follows from the count. The
// counter itself is only ever moved by sign-ups (see addUser). The CHECKs in the table
// keep hard >= soft >= 0.
export async function setSignupLimits(softLimit: number, hardLimit: number): Promise<void> {
  await db().query('UPDATE signup_counter SET soft_limit = $1, hard_limit = $2', [
    softLimit,
    hardLimit,
  ])
}

// Invite codes only show anywhere (profiles, texts that mention them) while sign-up needs
// one. In every other state they are kept but hidden.
export async function isInviteOnly(): Promise<boolean> {
  return (await getSignupState()) === 'invite'
}

// How many invite codes each new user gets to share, at sign-up.
export const invitesPerUser = 3

// No look-alikes (no 0/O, 1/I/L). 31 symbols, so 12 of them are about 59 random bits: far
// too many to guess. Must match the CHECK in db/migrations/*_invite-codes.sql.
const inviteAlphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

const inviteCodeLength = 12

function generateInviteCode(): string {
  return Array.from(
    { length: inviteCodeLength },
    () => inviteAlphabet[randomInt(inviteAlphabet.length)],
  ).join('')
}

// A code as people type or paste it: any letter case, with spaces or dashes. Returns the
// code as stored, or undefined if it can't be one.
export function normalizeInviteCode(input: string): string | undefined {
  const code = input.replace(/[\s-]/g, '').toUpperCase()
  const valid =
    code.length === inviteCodeLength && [...code].every((c) => inviteAlphabet.includes(c))
  return valid ? code : undefined
}

// Creates `count` new codes owned by the user. `client` lets addUser do it inside its
// transaction. Admins mint in bulk with `node db/mint-invites.ts`.
export async function mintInviteCodes(
  userId: number,
  count: number,
  expiresAt: Date | null = null,
  client: Pick<pg.PoolClient, 'query'> = db(),
): Promise<string[]> {
  const codes = Array.from({ length: count }, generateInviteCode)
  await client.query(
    'INSERT INTO invite_codes (code, user_id, expires_at) SELECT unnest($1::text[]), $2, $3',
    [codes, userId, expiresAt],
  )
  return codes
}

// One of the user's own codes, as listed on their profile. `usedBy` is the username of
// whoever signed up with it.
export type InviteCode = {
  code: string
  usedBy: string | null
  usedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}

// Unused codes first, so the ones left to share are on top.
export async function listInviteCodes(userId: number): Promise<InviteCode[]> {
  const { rows } = await db().query<InviteCode>(
    `SELECT i.code, u.username AS "usedBy", i.used_at AS "usedAt",
       i.expires_at AS "expiresAt", i.created_at AS "createdAt"
     FROM invite_codes i LEFT JOIN users u ON u.id = i.used_by_user_id
     WHERE i.user_id = $1
     ORDER BY i.used_at IS NOT NULL, i.used_at DESC, i.created_at, i.code`,
    [userId],
  )
  return rows
}

// The username of whoever invited the user, or null if they signed up without a code.
export async function getInvitedBy(userId: number): Promise<string | null> {
  const { rows } = await db().query<{ username: string }>(
    `SELECT u.username FROM invite_codes i JOIN users u ON u.id = i.user_id
     WHERE i.used_by_user_id = $1`,
    [userId],
  )
  return rows[0]?.username ?? null
}

// Someone who asked to be let in once sign-up was full. No personal data: only the
// username they'd like, which isn't reserved for them.
export type WaitlistEntry = {
  username: string
  status: 'waiting' | 'joined'
  createdAt: Date
}

// Adds the username to the waitlist. Joining twice, in any letter case, does nothing.
export async function joinWaitlist(username: string): Promise<WaitlistEntry> {
  await db().query('INSERT INTO waitlist (username) VALUES ($1) ON CONFLICT DO NOTHING', [username])
  return (await getWaitlistEntry(username))!
}

export async function getWaitlistEntry(username: string): Promise<WaitlistEntry | undefined> {
  const { rows } = await db().query<WaitlistEntry>(
    `SELECT username, status, created_at AS "createdAt" FROM waitlist
     WHERE lower(username) = lower($1)`,
    [username],
  )
  return rows[0]
}

export async function countWaiting(): Promise<number> {
  const { rows } = await db().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM waitlist WHERE status = 'waiting'`,
  )
  return rows[0].count
}
