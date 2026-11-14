import { db } from '../../db.ts'
import { type Blurt, liveUser, queryShown, selectShown } from './blurts.ts'

// Reports a blurt. One report per user and blurt: reporting it again does nothing, also
// after the first report was dismissed. False if the user no longer exists.
export async function addReport(userId: number, blurtId: number, reason: string): Promise<boolean> {
  const { rowCount } = await db().query(
    `INSERT INTO reports (user_id, blurt_id, reason) SELECT id, $2, $3 FROM (${liveUser}) u
     ON CONFLICT DO NOTHING`,
    [userId, blurtId, reason],
  )
  return rowCount === 1 || (await hasReported(userId, blurtId))
}

export async function hasReported(userId: number, blurtId: number): Promise<boolean> {
  const { rowCount } = await db().query(
    'SELECT 1 FROM reports WHERE user_id = $1 AND blurt_id = $2',
    [userId, blurtId],
  )
  return rowCount === 1
}

export type Report = { reporter: string; reason: string; createdAt: Date }

// A reported blurt and its open (not dismissed) reports, oldest first.
export type ReportedBlurt = { blurt: Blurt; reports: Report[] }

const reportedBlurtsLimit = 100

// Blurts with open reports, the one waiting longest first.
export async function listOpenReports(): Promise<ReportedBlurt[]> {
  const blurts = await queryShown(
    db(),
    `SELECT x.* FROM (SELECT blurt_id, min(created_at) AS first FROM reports
                       WHERE dismissed_at IS NULL GROUP BY blurt_id) o
     CROSS JOIN LATERAL (${selectShown('r.id = o.blurt_id')}) x
     ORDER BY o.first, x.id LIMIT $1`,
    [reportedBlurtsLimit],
  )
  const { rows: reports } = await db().query<Report & { blurtId: number }>(
    `SELECT r.blurt_id AS "blurtId", u.username AS reporter, r.reason, r.created_at AS "createdAt"
     FROM reports r JOIN users u ON u.id = r.user_id
     WHERE r.dismissed_at IS NULL AND r.blurt_id = ANY($1::bigint[])
     ORDER BY r.created_at, u.username`,
    [blurts.map((blurt) => blurt.id)],
  )
  return blurts.map((blurt) => ({
    blurt,
    reports: reports
      .filter((report) => report.blurtId === blurt.id)
      .map(({ reporter, reason, createdAt }) => ({ reporter, reason, createdAt })),
  }))
}

// Dismisses every open report on the blurt: it stays up.
export async function dismissReports(blurtId: number): Promise<void> {
  await db().query(
    'UPDATE reports SET dismissed_at = now() WHERE blurt_id = $1 AND dismissed_at IS NULL',
    [blurtId],
  )
}
