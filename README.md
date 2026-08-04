# Seller Home prototype

An agentic Salesforce Seller Home surface, built as a static prototype on the
Lightning Design System. There is no backend: every "agent" response is
authored content played back on a timer, so the whole demo can be edited as
data.

Two pages carry the demo:

| Page | Route | What it shows |
| --- | --- | --- |
| Seller Home | `/index.html` | Briefing, composer, and the Ready to Review cards, over the animated god-rays background |
| Conversation | `/home_conversation.html` | The drill-in: the thread plays itself in on load, then a send drafts a multi-touch outreach cadence per prospect |

`/blank.html` and `/god-rays-js.html` are scratch pages — a bare shell and a
tuning harness for the background shader.

## Running locally

```bash
npm install
npm run dev
```

That builds into `dist/` and opens a Browsersync server that rebuilds and
reloads on save. Styles hot-swap without a refresh; templates, scripts, and
data trigger a reload.

To run what the deployed copy runs:

```bash
npm run build   # one-shot build into dist/
npm start       # express, serving dist/ on PORT (default 3000)
```

## Deploying to Heroku

The app belongs to the **sfdc-salesux** team, so it has to be created with
`--team` — without that flag it lands in your personal account and the team
can't see it.

```bash
heroku login
heroku create <app-name> --team sfdc-salesux
git push heroku main
```

Heroku runs `npm run build` during the build phase and then the `Procfile`'s
`web: node server.js`. Nothing else is required — no add-ons, no config vars.

Already created the app in the wrong place? `heroku apps:transfer
sfdc-salesux -a <app-name>` moves it, no redeploy needed.

To put the prototype behind a password, set both:

```bash
heroku config:set BASIC_AUTH_USER=... BASIC_AUTH_PASSWORD=...
```

Auth is off unless both are present. They are deliberately not named
`USERNAME`/`PASSWORD`: `USERNAME` is already set in most shells and CI images
and would quietly override whatever you configured.

## Where things live

```
src/
  views/          Nunjucks templates. A page is any .html not prefixed with _;
                  _partials.html are includes and macro libraries.
    data/         Page content. foo.json feeds foo.html; shared.json feeds
                  every page. JSON5, so the files carry comments — most of
                  the documentation for a component sits next to its data.
  styles/         Sass, one entry point per page.
  scripts/        Plain browser JS, no bundler. Loaded per page.
  assets/         Images and icons, copied through to dist/ as-is.
gulpfile.js       The build: clean, assets, views, styles, scripts, favicon.
server.js         Production static server.
```

`dist/` is generated and git-ignored. Delete it any time.

### Editing the demo

Most changes are data, not code:

- **Seller Home copy** — `src/views/data/index.json`: the greeting and
  briefing sentence, the composer prompts, the Ready to Review cards.
- **The conversation** — also `index.json`, under `conversations.conv-001`.
  `messages` is the thread, `opening.stages` decides which messages arrive on
  a timer and how long the agent "thinks" before each, and `scriptedTurns` is
  the reply queue: one send plays one turn.
- **Drafted cadences** — inside that turn's `cadence`, keyed per prospect with
  a `default` fallback. Copy can use `{firstName}`, `{company}`, and
  `{signal}` tokens, filled per prospect at render time.

Each of those keys has a comment above it in the JSON explaining its contract.

## Housekeeping

```bash
npm run lint:js
npm run lint:css
```

Built from the [Salesforce Design System Starter Kit](https://github.com/salesforce-ux/design-system-starter-kit).
