// Mints invite codes in bulk, for launches and press. The codes belong to an existing user
// (e.g. the blurt.trade account), are listed on that user's profile, and print here one
// per line:
//
//   node db/mint-invites.ts <username> <count> [days until they expire]
//
// Uses DATABASE_URL, like the app (PgBouncer on port 6433 by default).
import { closeDb } from '../src/db.ts'
import { getUserByUsername, mintInviteCodes } from '../src/routes/state.ts'

const [username, countArgument, daysArgument] = process.argv.slice(2)
const count = Number(countArgument)
const days = daysArgument === undefined ? undefined : Number(daysArgument)

if (!username || !Number.isInteger(count) || count < 1 || count > 10_000) {
  console.error('Usage: node db/mint-invites.ts <username> <count 1-10000> [days until expiry]')
  process.exit(1)
}
if (days !== undefined && !(days > 0)) {
  console.error('Days until expiry must be a positive number')
  process.exit(1)
}

try {
  const user = await getUserByUsername(username)
  if (!user) {
    console.error(`No user named ${username}`)
    process.exitCode = 1
  } else {
    const expiresAt = days === undefined ? null : new Date(Date.now() + days * 86_400_000)
    const codes = await mintInviteCodes(user.id, count, expiresAt)
    console.log(codes.join('\n'))
  }
} finally {
  await closeDb()
}
