import { avatarSchema, describeAvatar, maxPictureCut, minPictureCut } from '../../avatar.ts'
import { pageContext } from '../../page-context.ts'
import type { ProfileEditData } from './data.ts'
import { profileFields, profileValue } from '../profile/profile.md.ts'
import { code, join, link, type Markdown, md } from '../shared/markdown.ts'
import { eyeTypes, hairTypes, headWidths, toothTypes } from '../../shared/avatar.ts'
import { formatLocation, gridDescription } from '../../shared/geo.ts'
import { themes } from '../../shared/themes.ts'
import { notificationsPath } from '../../ui/urls.ts'

// The edit page (/:username/edit) as Markdown: the same data as the HTML, for text/markdown
// and text/plain clients (curl, LLMs, terminals). Forms are described instead of rendered.

export function profileEditMarkdown({
  profile,
  location,
  notifications,
}: ProfileEditData): Markdown {
  const fields = profileFields.map(
    ([key, label]) => md`- ${code(key)} (${label}): ${profileValue(String(profile[key]))}`,
  )
  // With a profile picture the cartoon is never shown, so its settings aren't either.
  const cartoon = profile.avatar.photo
    ? ''
    : md`
    ## Avatar

    Yours: ${describeAvatar(profile.avatar)}.

    Send ${code('POST /api/avatar')} with all of ${join(Object.keys(avatarSchema.shape).map(code), ', ')}
    to change it, or with ${code('random')} for a random one. Colours are ${code('#rrggbb')}. The
    head is one of ${join(headWidths.map(code), ', ')} wide. Hair is one of ${join(hairTypes.map(code), ', ')}; eyes one of ${join(eyeTypes.map(code), ', ')};
    teeth one of ${join(toothTypes.map(code), ', ')}.
    `
  return md`
    # Edit profile: ${profile.username}

    ${link('Back to profile', `/${profile.username}/`)}

    Send ${code(`POST /${profile.username}/edit`)} as a form or as JSON. Fields left out are
    cleared. Current values:

    ${join(fields, '\n')}

    ${cartoon}

    ## Profile picture

    ${profile.avatar.photo ? md`You have one: it is shown instead of the cartoon, cut ${profile.avatar.photo.cut}% from the top to talk.` : "You haven't uploaded one: the cartoon is shown."}

    Send ${code('POST /api/profile-picture')} as ${code('multipart/form-data')} with the image
    (JPEG, PNG or WebP) in ${code('picture')} to upload one, or with ${code('remove')} to remove
    it. It is cropped square and redrawn as a rough drawing; only the drawing is kept. Send
    ${code('POST /api/profile-picture/cut')} with ${code('cut')}, from ${minPictureCut} to ${maxPictureCut}, for where it
    opens its mouth, in percent from the top.

    ## Location

    ${location ? md`Your location: ${formatLocation(location)} (the middle of ${gridDescription}).` : "You haven't set a location."}

    Send ${code('POST /api/location')} with ${code('lat')} and ${code('lon')} to set it (only
    ${gridDescription} is stored), or with ${code('clear')} to remove it. Nobody else can see
    it. Then see ${link('blurts near you', '/near')}.

    ## Notifications

    Now: replies ${notifications.replies ? 'on' : 'off'}, reblurts and quotes ${notifications.reblurts ? 'on' : 'off'},
    blurts from people you follow ${notifications.followedBlurts ? 'on' : 'off'}. See
    ${link('your notifications', notificationsPath(profile.username))}.

    Send ${code('POST /api/notifications/settings')} with ${code('replies')}, ${code('reblurts')}
    and ${code('followedBlurts')} (${code('1')}, ${code('on')} or ${code('true')} for on, JSON
    ${code('true')}). Kinds left out are switched off. A quote counts as a reblurt here.

    ## Theme

    Yours: ${code(pageContext().theme)}.

    Send ${code('POST /api/theme')} with ${code('theme')}, one of ${join(
      themes.map((theme) => code(theme.id)),
      ', ',
    )},
    to pick the colours of the HTML pages, on every device you're logged in on.

    ## Time zone

    Yours: ${code(pageContext().timeZone)} (UTC until you pick one), written the way
    ${code(pageContext().locale)} does (your browser's language until you pick one).

    Send ${code('POST /api/timezone')} with ${code('timezone')}, an IANA name like
    ${code('Europe/Oslo')}, and/or ${code('locale')}, like ${code('nb-NO')} or ${code('en-US')}
    (empty for your browser's language), to set how the HTML pages show times.
  `
}
