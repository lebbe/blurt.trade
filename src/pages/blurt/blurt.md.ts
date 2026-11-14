import type { BlurtPageData } from './data.ts'
import { blurtList, blurtMarkdown, home } from '../shared/blurts.md.ts'
import { code, link, type Markdown, md } from '../shared/markdown.ts'
import type { Blurt } from '../../routes/state/blurts.ts'
import { blurtActions, reblurtAction } from '../../ui/blurt-card.ts'
import type { Viewer } from '../../ui/context.ts'
import { deleteBlurtPath, moreRepliesUrl } from '../../ui/urls.ts'

// A blurt page (/:username/:id) and its thread as Markdown: the same data as the HTML, for
// text/markdown and text/plain clients (curl, LLMs, terminals). Forms are described instead
// of rendered.

// What the viewer can do to the blurt, as the requests to send.
function blurtActionsMarkdown(viewer: Viewer, blurt: Blurt, reported: boolean): Markdown | null {
  const like =
    viewer &&
    !blurt.deleted &&
    md`${blurt.viewerLikes ? 'Unlike' : 'Like'} it with ${code(`POST ${blurt.viewerLikes ? '/api/unlike' : '/api/like'}`)} and ${code(`blurtId=${blurt.id}`)}.`
  const reblurt = reblurtAction(viewer, blurt)
  const quote =
    viewer &&
    !blurt.deleted &&
    md`Quote it with ${code('POST /api/blurts')}, ${code('text')} and ${code(`reblurtOfId=${blurt.id}`)}.`
  return md`
    ${like}

    ${reblurt && md`${reblurt === 'unreblurt' ? 'Undo your reblurt' : 'Reblurt it'} with ${code(`POST /api/${reblurt}`)} and ${code(`blurtId=${blurt.id}`)}.`}

    ${quote}

    ${actionMarkdown(viewer, blurt, reported)}
  `
}

function actionMarkdown(viewer: Viewer, blurt: Blurt, reported: boolean): Markdown | null {
  const action = blurtActions(viewer, blurt)
  if (action === 'delete') {
    return md`Delete it with ${code(`POST ${deleteBlurtPath(blurt)}`)}.`
  }
  if (action === 'report') {
    return reported
      ? md`
You reported this blurt.
        `
      : md`Report it with ${code('POST /api/report')}, ${code('blurtId')} and an optional ${code('reason')}.`
  }
  return null
}

export function blurtPageMarkdown({
  viewer,
  blurt,
  parent,
  reported,
  replies,
  next,
  related,
}: BlurtPageData): Markdown {
  return md`
    # ${blurt.username ?? 'Deleted blurt'}

    ${home}

    ${
      parent &&
      md`
        ## In reply to

        ${blurtMarkdown(parent)}
      `
    }

    ${blurtMarkdown(blurt, [], true)}

    ${blurtActionsMarkdown(viewer, blurt, reported)}

    ## Replies

    ${blurtList(replies, true)}

    ${next && link('More replies', moreRepliesUrl(blurt, next))}

    ## Related blurts

    ${blurtList(related)}
  `
}
