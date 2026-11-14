import type { AdminReportsData, AdminToolsData } from './data.ts'
import { blurtMarkdown, home } from '../shared/blurts.md.ts'
import { code, join, link, type Markdown, md, raw } from '../shared/markdown.ts'
import { deleteBlurtPath } from '../../ui/urls.ts'

// The admin pages: /admin and /admin/reports as Markdown: the same data as the HTML, for
// text/markdown and text/plain clients (curl, LLMs, terminals). Forms are described instead
// of rendered.

export function adminToolsMarkdown({ minted, limits }: AdminToolsData): Markdown {
  return md`
    # Admin

    ${home}

    Sign-up: ${limits.state} (${limits.count} sign-ups so far, soft limit ${limits.softLimit}, hard limit ${limits.hardLimit}).

    ${minted ? md`Minted for ${minted.username}:` : ''}

    ${
      minted
        ? join(
            minted.codes.map((minted) => md`- ${code(minted)}`),
            '\n',
          )
        : ''
    }

    - ${link('Open reports', '/admin/reports')}
    - Delete a blurt: ${code('POST /api/admin/blurts/delete')} with ${code('blurtId')}
    - Dismiss reports: ${code('POST /api/admin/reports/dismiss')} with ${code('blurtId')}
    - Set the sign-up limits: ${code('POST /api/admin/signup-limits')} with ${code('softLimit')} (invite codes needed from here) and ${code('hardLimit')} (closed from here)
    - Mint invite codes:${code('POST /api/admin/invites')} with ${code('username')}, ${code('count')} (1–1000) and optionally ${code('days')}
  `
}

export function adminReportsMarkdown({ reports }: AdminReportsData): Markdown {
  return md`
    # Reports

    ${home}

    ${
      reports.length > 0
        ? reports.map(
            ({ blurt, reports: open }) => md`
              ${blurtMarkdown(blurt)}

              ${join(
                open.map(
                  (report) =>
                    md`- ${link(report.reporter, `/${report.reporter}/`)}: ${report.reason || raw('_no reason given_')}`,
                ),
                '\n',
              )}

              Delete it with ${code(`POST ${deleteBlurtPath(blurt)}`)}, or dismiss the reports with ${code('POST /api/admin/reports/dismiss')} and ${code(`blurtId=${blurt.id}`)}.
            `,
          )
        : 'No open reports.'
    }
  `
}
