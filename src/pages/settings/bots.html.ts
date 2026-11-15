import { h } from 'preact'
import type { BotData, BotsData } from './data.ts'
import { ButtonLink } from '../shared/components.ts'
import { Page, renderDocument } from '../shared/layout.ts'
import { bioMaxLength, usernameMaxLength } from '../../shared/limits.ts'
import { AvatarForm } from '../../ui/avatar-form.ts'
import { AvatarView } from '../../ui/avatar.ts'
import { Timestamp } from '../../ui/blurt-card.ts'
import { SubmitButton, ValidationError } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'

// /settings/bots and /settings/bots/:username: the bots a person runs (tickets/031-bots.md,
// src/routes/bots.ts). Plain forms, like every other setting.

const back = (href: string, label: string) =>
  html`<${ButtonLink} href=${href} icon="back" label=${label} />`

function BotsPage({ bots, maxBots, validationError }: BotsData & { validationError?: string }) {
  return html`
    <${Page}
      title="Your bots"
      tagline="Accounts that blurt through the API, run by you."
      actions=${back('/settings', 'Back to settings')}
    >
      <section class="panel" aria-label="Your bots">
        <h2>Your bots</h2>
        ${
          bots.length > 0
            ? html`<ul class="bot-list">
                ${bots.map(
                  (bot) =>
                    html`<li>
                      <a href="/settings/bots/${bot.username}">${bot.username}</a>
                      ${
                        bot.owners.length > 1 &&
                        html`<span class="tiny"> · with ${bot.owners.length - 1} more</span>`
                      }
                    </li>`,
                )}
              </ul>`
            : html`<p class="empty">You don't run any bots yet.</p>`
        }
      </section>
      <section class="panel" id="new-bot" aria-label="New bot">
        <h2>New bot</h2>
        <p>
          A bot is an account of its own, labelled “Bot” and drawn as a robot. It has no password:
          nobody logs in as it. You run it from here, and it blurts with an API token. At most
          ${' '}${maxBots} bots.
        </p>
        <form method="post" action="/settings/bots">
          <${ValidationError} message=${validationError} />
          <label
            >Its username
            <input
              name="username"
              maxlength=${usernameMaxLength}
              pattern="[A-Za-z0-9_]+"
              autocomplete="off"
              required
          /></label>
          <div class="actions">
            <${SubmitButton} icon="robot" label="Make the bot" />
          </div>
        </form>
      </section>
    <//>
  `
}

type BotErrors = { avatar?: string; bio?: string; tokens?: string; owners?: string }

function Bio({ bot, bio, error }: BotData & { error?: string }) {
  return html`
    <section class="panel" id="bio" aria-label="Bio">
      <h2>Bio</h2>
      <form method="post" action="/api/bots/${bot.username}/bio">
        <${ValidationError} message=${error} />
        <label
          >What the bot is, and what it blurts
          <textarea name="bio" maxlength=${bioMaxLength} placeholder="Beep boop.">${bio}</textarea>
        </label>
        <div class="actions">
          <${SubmitButton} icon="edit" label="Save the bio" />
        </div>
      </form>
    </section>
  `
}

function Tokens({ bot, tokens, maxTokens, newToken, error }: BotData & { error?: string }) {
  return html`
    <section class="panel" id="tokens" aria-label="API tokens">
      <h2>API tokens</h2>
      ${
        newToken &&
        html`<div class="new-token" role="status">
          <p>
            <strong>Your new token “${newToken.name}”.</strong> Copy it now: it is never shown
            again.
          </p>
          <p><code>${newToken.token}</code></p>
        </div>`
      }
      <p>
        The bot blurts with <code>${'Authorization: Bearer <token>'}</code> on
        <code>/api/v1/</code> (see <a href="/about#bots">the bot API</a>). Revoke a token you lost;
        the bot's other tokens keep working.
      </p>
      ${
        tokens.length > 0
          ? html`<ul class="token-list">
              ${tokens.map(
                (token) =>
                  html`<li>
                    <strong>${token.name}</strong>
                    <span class="tiny"
                      >made <${Timestamp} date=${token.createdAt} />,
                      ${
                        token.lastUsedAt
                          ? html`last used <${Timestamp} date=${token.lastUsedAt} />`
                          : 'never used'
                      }</span
                    >
                    <form
                      method="post"
                      action="/api/bots/${bot.username}/tokens/${token.id}/revoke"
                      class="inline"
                    >
                      <${SubmitButton} icon="trash" label="Revoke" kind="danger" />
                    </form>
                  </li>`,
              )}
            </ul>`
          : html`<p class="empty">No tokens yet.</p>`
      }
      <form method="post" action="/api/bots/${bot.username}/tokens">
        <${ValidationError} message=${error} />
        <label
          >Name, e.g. where the bot runs
          <input name="name" maxlength="50" autocomplete="off" required
        /></label>
        <div class="actions">
          <${SubmitButton}
            icon="shield"
            label=${tokens.length >= maxTokens ? `At most ${maxTokens} tokens` : 'New token'}
          />
        </div>
      </form>
    </section>
  `
}

function Owners({ viewer, bot, error }: BotData & { error?: string }) {
  const remove = (username: string, label: string) =>
    html`<form method="post" action="/api/bots/${bot.username}/owners/remove" class="inline">
      <input type="hidden" name="username" value=${username} />
      <${SubmitButton} icon="logout" label=${label} kind="secondary" />
    </form>`
  return html`
    <section class="panel" id="owners" aria-label="Owners">
      <h2>Owners</h2>
      <p>
        Everyone here can do all of this: the avatar, the tokens, the owners, and deleting the bot.
        To hand the bot over, share it and then leave.
      </p>
      <ul class="owner-list">
        ${bot.owners.map(
          (owner) =>
            html`<li>
              <a href="/${owner}/">${owner}</a>
              ${
                owner === viewer.username
                  ? bot.owners.length > 1 && remove(owner, 'Leave')
                  : remove(owner, 'Take off')
              }
            </li>`,
        )}
      </ul>
      <form method="post" action="/api/bots/${bot.username}/owners">
        <${ValidationError} message=${error} />
        <label
          >Share with (their username)
          <input name="username" maxlength=${usernameMaxLength} autocomplete="off" required
        /></label>
        <div class="actions">
          <${SubmitButton} icon="people" label="Share the bot" />
        </div>
      </form>
    </section>
  `
}

function BotPage(data: BotData & { errors: BotErrors }) {
  const { bot, avatar, errors } = data
  return html`
    <${Page}
      title=${html`${bot.username} <span class="bot-label">Bot</span>`}
      tagline="Run by you, from your own account."
      lead=${html`<${AvatarView} avatar=${avatar} label="${bot.username}'s avatar" size="large" />`}
      actions=${html`${back('/settings/bots', 'Your bots')}<${ButtonLink}
          href="/${bot.username}/"
          icon="person"
          label="Its profile"
        />`}
    >
      <${AvatarForm}
        avatar=${{ ...avatar, robot: true }}
        error=${errors.avatar}
        action="/api/bots/${bot.username}/avatar"
        label="${bot.username}'s avatar"
      />
      <${Bio} ...${data} error=${errors.bio} />
      <${Tokens} ...${data} error=${errors.tokens} />
      <${Owners} ...${data} error=${errors.owners} />
      <section class="panel" aria-label="Delete the bot">
        <h2 class="warn">Delete the bot</h2>
        <p>
          Its blurts, follows, likes and tokens are deleted, and its username is retired. It can't
          be undone.
        </p>
        <form method="post" action="/api/bots/${bot.username}/delete">
          <${SubmitButton} icon="warning" label="Delete ${bot.username} for good" kind="danger" />
        </form>
      </section>
    <//>
  `
}

export function renderBotsPage(data: BotsData, validationError?: string): string {
  return renderDocument(h(BotsPage, { ...data, validationError }), {
    title: 'Your bots',
    noindex: true,
  })
}

export function renderBotPage(data: BotData, errors: BotErrors = {}): string {
  return renderDocument(h(BotPage, { ...data, errors }), {
    title: data.bot.username,
    noindex: true,
  })
}
