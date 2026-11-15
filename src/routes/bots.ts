import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  clearSessionCookies,
  requireAdmin,
  requireAuth,
  type AuthenticatedUser,
} from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { usernameMaxLength } from '../limits.ts'
import {
  fieldErrors,
  represent,
  sendError,
  sendFormErrors,
  sendFormSuccess,
  toJson,
  wantsJson,
} from '../negotiate.ts'
import { avatarFromBody } from './avatar.ts'
import { deleteAccount } from './state/accounts.ts'
import {
  type OwnedBot,
  addOwner,
  createBot,
  createToken,
  getOwnedBot,
  listOwnedBots,
  listTokens,
  maxBotsPerOwner,
  maxTokensPerBot,
  removeOwner,
  revokeToken,
  setHideBots,
  setOwner,
  tokenNameMaxLength,
} from './state/bots.ts'
import { profileSchema } from './profiles.ts'
import { getUserProfileByUsername, setAvatar, setBio } from './state/profiles.ts'
import { newUsername } from './users.ts'
import type { BotData, BotsData } from '../pages/settings/data.ts'
import { renderBotPage, renderBotsPage } from '../pages/settings/bots.html.ts'
import { botMarkdown, botsMarkdown } from '../pages/settings/bots.md.ts'

// Bots (tickets/031-bots.md): made and run by people, from their own accounts. A bot has
// no password, so nobody logs in as it. Its owners make it on /settings/bots, and on
// /settings/bots/:username set its avatar, mint and revoke its API tokens, share it with
// other people (or hand it over: share, then leave) and delete it. All of that with the
// cookie login only: a bearer token never reaches these routes (src/middleware/auth.ts).
// Admins can set a bot's owner (/api/admin/bots/owner).
export const botsRouter = Router()

async function getBotsData(viewer: AuthenticatedUser): Promise<BotsData> {
  return { viewer, bots: await listOwnedBots(viewer.id), maxBots: maxBotsPerOwner }
}

async function getBotData(viewer: AuthenticatedUser, bot: OwnedBot): Promise<BotData> {
  const [profile, tokens] = await Promise.all([
    getUserProfileByUsername(bot.username),
    listTokens(bot.id),
  ])
  const { avatar, bio } = profile!
  return { viewer, bot, avatar, bio, tokens, maxTokens: maxTokensPerBot }
}

// The bot named in the path, for one of its owners; a 404 for anyone else, so nobody
// learns which bots someone runs from here (the bot's profile says so anyway).
async function ownedBot(request: Request, response: Response, next: NextFunction) {
  const bot = await getOwnedBot(
    response.locals.authenticatedUser.id,
    request.params.username as string,
  )
  if (!bot) {
    sendError(request, response, 404, 'Bot not found')
    return
  }
  response.locals.bot = bot
  next()
}

const manage = [requireAuth, ownedBot]

// Where a form goes back to on the bot's page.
const botPage = (bot: OwnedBot, part = '') => `/settings/bots/${bot.username}${part}`

// The bot's page again, with a failed form's message in its `part`.
async function rerenderBot(response: Response, part: 'avatar' | 'bio' | 'tokens' | 'owners') {
  const data = await getBotData(response.locals.authenticatedUser, response.locals.bot)
  return (message: string) => renderBotPage(data, { [part]: message })
}

// --- Making bots ------------------------------------------------------------------------

botsRouter.get('/settings/bots', requireAuth, async (request, response) => {
  await represent(request, response, await getBotsData(response.locals.authenticatedUser), {
    html: (data) => renderBotsPage(data),
    markdown: botsMarkdown,
  })
})

const createBotSchema = z.object({ username: newUsername })

botsRouter.post(
  '/settings/bots',
  requireAuth,
  rateLimit('bots', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const rerender = async (message: string) => renderBotsPage(await getBotsData(viewer), message)
    const result = createBotSchema.safeParse(request.body ?? {})
    if (!result.success) {
      await sendFormErrors(request, response, fieldErrors(result.error), rerender)
      return
    }
    const bot = await createBot(viewer.id, result.data.username)
    if (bot === 'full') {
      const message = `You can run at most ${maxBotsPerOwner} bots.`
      await sendFormErrors(request, response, [{ message }], rerender)
      return
    }
    if (bot === 'taken') {
      const errors = [{ field: 'username', message: 'Username is already taken' }]
      await sendFormErrors(request, response, errors, rerender)
      return
    }
    sendFormSuccess(request, response, {
      redirect: `/settings/bots/${bot.username}`,
      data: bot,
      status: 201,
      location: `/settings/bots/${bot.username}`,
    })
  },
)

// --- Running one ------------------------------------------------------------------------

botsRouter.get('/settings/bots/:username', ...manage, async (request, response) => {
  await represent(
    request,
    response,
    await getBotData(response.locals.authenticatedUser, response.locals.bot),
    { html: (data) => renderBotPage(data), markdown: botMarkdown },
  )
})

// Like /api/avatar, for the bot (and autosaved the same way, src/client/autosave.ts).
botsRouter.post(
  '/api/bots/:username/avatar',
  ...manage,
  rateLimit('avatar', accountKey),
  async (request, response) => {
    const bot: OwnedBot = response.locals.bot
    const parsed = avatarFromBody(request.body)
    if ('errors' in parsed) {
      await sendFormErrors(request, response, parsed.errors, await rerenderBot(response, 'avatar'))
      return
    }
    await setAvatar(bot.id, parsed.avatar)
    sendFormSuccess(request, response, {
      redirect: botPage(bot, '#avatar'),
      data: { avatar: { ...parsed.avatar, robot: true } },
    })
  },
)

// The bio, validated as on the profile's own edit page.
const bioSchema = z.object({ bio: profileSchema.shape.bio })

botsRouter.post(
  '/api/bots/:username/bio',
  ...manage,
  rateLimit('profileEdit', accountKey),
  async (request, response) => {
    const bot: OwnedBot = response.locals.bot
    const result = bioSchema.safeParse(request.body ?? {})
    if (!result.success) {
      await sendFormErrors(
        request,
        response,
        fieldErrors(result.error),
        await rerenderBot(response, 'bio'),
      )
      return
    }
    await setBio(bot.id, result.data.bio)
    sendFormSuccess(request, response, { redirect: botPage(bot, '#bio'), data: result.data })
  },
)

const tokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name the token, e.g. after where the bot runs')
    .max(tokenNameMaxLength, `A token name is at most ${tokenNameMaxLength} characters`),
})

// The token is shown once, in this response: the bot's page with it on top, or JSON.
botsRouter.post(
  '/api/bots/:username/tokens',
  ...manage,
  rateLimit('tokens', accountKey),
  async (request, response) => {
    const bot: OwnedBot = response.locals.bot
    const result = tokenSchema.safeParse(request.body ?? {})
    if (!result.success) {
      await sendFormErrors(
        request,
        response,
        fieldErrors(result.error),
        await rerenderBot(response, 'tokens'),
      )
      return
    }
    const created = await createToken(bot.id, result.data.name)
    if (created === 'full') {
      const message = `A bot can have at most ${maxTokensPerBot} tokens. Revoke one first.`
      await sendFormErrors(request, response, [{ message }], await rerenderBot(response, 'tokens'))
      return
    }
    response.set('Cache-Control', 'no-store') // it carries the token
    response.vary('Accept').status(201)
    if (wantsJson(request)) {
      response.type('json').send(toJson(created))
    } else {
      const data = await getBotData(response.locals.authenticatedUser, bot)
      response.type('html').send(renderBotPage({ ...data, newToken: created }))
    }
  },
)

botsRouter.post(
  '/api/bots/:username/tokens/:id/revoke',
  ...manage,
  rateLimit('tokens', accountKey),
  async (request, response) => {
    const bot: OwnedBot = response.locals.bot
    const id = /^\d{1,15}$/.test(request.params.id as string) ? Number(request.params.id) : NaN
    if (Number.isNaN(id) || !(await revokeToken(bot.id, id))) {
      sendError(request, response, 404, 'Token not found')
      return
    }
    sendFormSuccess(request, response, { redirect: botPage(bot, '#tokens') })
  },
)

const ownerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Username is required')
    .max(usernameMaxLength, 'Username is too long'),
})

// Shares the bot with another person: they can do all of this too.
botsRouter.post(
  '/api/bots/:username/owners',
  ...manage,
  rateLimit('bots', accountKey),
  async (request, response) => {
    const bot: OwnedBot = response.locals.bot
    const result = ownerSchema.safeParse(request.body ?? {})
    const errors = !result.success
      ? fieldErrors(result.error)
      : (await addOwner(bot.id, result.data.username)) === 'no-user'
        ? [{ field: 'username', message: 'No such person (bots can’t run bots)' }]
        : []
    if (errors.length > 0) {
      await sendFormErrors(request, response, errors, await rerenderBot(response, 'owners'))
      return
    }
    const updated = await getOwnedBot(response.locals.authenticatedUser.id, bot.username)
    sendFormSuccess(request, response, {
      redirect: botPage(bot, '#owners'),
      data: { owners: updated?.owners ?? [] },
    })
  },
)

// Takes an owner off: someone else, or yourself (leaving). Handing a bot over is sharing it
// and then leaving. The last owner can't leave; they delete the bot instead.
botsRouter.post(
  '/api/bots/:username/owners/remove',
  ...manage,
  rateLimit('bots', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const bot: OwnedBot = response.locals.bot
    const result = ownerSchema.safeParse(request.body ?? {})
    if (!result.success) {
      await sendFormErrors(
        request,
        response,
        fieldErrors(result.error),
        await rerenderBot(response, 'owners'),
      )
      return
    }
    const removed = await removeOwner(bot.id, result.data.username)
    if (removed === 'not-owner') {
      sendError(request, response, 404, 'Not an owner of this bot')
      return
    }
    if (removed === 'last') {
      const message = 'A bot always has an owner. Share it first, or delete it.'
      await sendFormErrors(request, response, [{ message }], await rerenderBot(response, 'owners'))
      return
    }
    const left = result.data.username.toLowerCase() === viewer.username.toLowerCase()
    sendFormSuccess(request, response, {
      redirect: left ? '/settings/bots' : botPage(bot, '#owners'),
    })
  },
)

// Deletes the bot like an account (deleteAccount): its blurts, follows, likes and tokens
// go, and its username is retired.
botsRouter.post(
  '/api/bots/:username/delete',
  ...manage,
  rateLimit('deleteBlurt', accountKey),
  async (request, response) => {
    await deleteAccount((response.locals.bot as OwnedBot).id)
    sendFormSuccess(request, response, { redirect: '/settings/bots' })
  },
)

// --- Admins -----------------------------------------------------------------------------

// Makes `owner` the bot's only owner: for a bot whose owners are gone or misbehave.
botsRouter.post('/api/admin/bots/owner', requireAdmin, async (request, response) => {
  const bot = await getOwnedBot(
    response.locals.authenticatedUser.id,
    String(request.body?.bot ?? ''),
    true,
  )
  if (!bot) {
    sendError(request, response, 404, 'Bot not found')
    return
  }
  if ((await setOwner(bot.id, String(request.body?.owner ?? ''))) === 'no-user') {
    sendError(request, response, 404, 'No such person', 'owner')
    return
  }
  sendFormSuccess(request, response, {
    redirect: '/admin',
    data: { bot: bot.username, owner: request.body.owner },
  })
})

// --- Hide bots ---------------------------------------------------------------------------

function isOn(value: unknown): boolean {
  return value === true || value === 'on' || value === 'true' || value === '1'
}

botsRouter.post(
  '/api/hide-bots',
  requireAuth,
  rateLimit('hideBots', accountKey),
  async (request, response) => {
    const hideBots = isOn(request.body?.hideBots)
    if (!(await setHideBots(response.locals.authenticatedUser.id, hideBots))) {
      clearSessionCookies(response) // a still-valid token for an account that is gone
      sendError(request, response, 401, 'Authentication required')
      return
    }
    sendFormSuccess(request, response, { redirect: '/settings#bots', data: { hideBots } })
  },
)
