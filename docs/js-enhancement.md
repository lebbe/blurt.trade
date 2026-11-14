# JavaScript i nettleseren for blurt.trade – evaluering

## Oppgaver

| Steg | Oppgave |
| --- | --- |
| 1 | #32 Mykere navigering uten JS (View Transitions, Speculation Rules) |
| 2 | #33 Refaktorering: isomorfe maler skilt fra server-only |
| 3 | #34 Ta i bruk preact-hook-signal-htm-bundle v3 (avhenger av lebbe/preact-hook-signal-htm-bundle#3) |
| 4 | #35 Infrastruktur: type-stripping, import map, CSP, opt-out, tester |
| 5 | #36 Autosave i innstillinger, kart og munn uten navigering |
| 6 | #37 Refaktorering: én mappe per side og komponent |
| 7 | #38 Blurten inn i feeden, evig scroll, likes og reblurts uten reload |
| 8 | #39 Notifikasjoner i sanntid (SSE) og Web Push |

Ingen kode er endret. Dette er en vurdering av hvordan JS kan legges på som progressiv
forbedring (opt-out), der alt fortsatt skal fungere uten JS.

## 0. Utgangspunktet er veldig godt

Det meste av jobben er allerede gjort på serversiden:

- **Alle POST-ruter svarer allerede med JSON** når `Accept: application/json` sendes
  (`sendFormSuccess`/`sendFormErrors` i `src/negotiate.ts`). `POST /api/blurts` gir
  `201` med blurten, `/api/location` gir `{ location }`, `/api/profile-picture/cut`
  gir `{ avatar }`, `/api/notifications/settings` gir innstillingene osv.
- **Alle GET-sider gir JSON** med nøyaktig de dataene siden ble rendret fra, inkludert
  `next`-cursor for paginering.
- Formene er ekte `<form>`er, så JS kan bygge `FormData` fra skjemaet og sende samme
  request med fetch. Ingen ny API trengs for punkt 1–4.
- `readYourWrites` (replica-cookie) fungerer også for fetch.

Det betyr at en «enhancer» stort sett er: fang `submit`/`click`, send samme request med
`fetch` og `Accept: application/json`, oppdater DOM, og **fall tilbake til vanlig
innsending hvis noe feiler**.

## 1. Arkitektur: øyer, ikke hydrering av hele siden

Anbefaling: **server-rendret HTML som før + små Preact-«øyer»** som monteres på
bestemte elementer (`data-enhance="autosave"`, `data-enhance="feed"` …).

- Én inngangsfil (`/static/js/main.ts`) som ser etter `data-enhance` og laster bare
  modulene siden trenger (`import()` dynamisk).
- Full hydrering av hele siden er feil verktøy her: det krever at all data sendes to
  ganger (HTML + JSON) og at *alle* maler finnes i nettleseren.
- Ikke alt trenger Preact. Autosave og klikk på kart er noen få linjer DOM-kode. Preact
  lønner seg der vi skal **rendre nytt innhold** (nye blurts, flere sider, notifikasjoner)
  – og da bare hvis malene deles med serveren.

### Opt-out

- En innstilling «Bruk JavaScript» (på som standard), lagret på kontoen og båret i
  access-tokenet slik tema allerede er, pluss en cookie for anonyme (lenke i footer).
- Når den er av, **sender serveren ingen `<script>` i det hele tatt** – ikke bare at
  koden slår seg av. Da er «uten JS» garantert identisk med i dag.

### Skjule lagreknapper uten å ødelegge fallback

- Ikke skjul knapper med `@media (scripting: enabled)` alene: hvis skriptet ikke lastes
  (nettverk, blokkert), står brukeren uten knapper.
- Skriptet setter `document.documentElement.dataset.js = 'on'` når det faktisk kjører,
  og CSS skjuler `[data-js=on] .autosave-button`. Kort flash av knapper er prisen, eller
  la knappen bli en «Lagret ✓»-statusindikator i stedet for å forsvinne.

## 2. De fem punktene

### 2.1 Ingen lagreknapper i innstillinger

- Select, radio og checkbox (tema, tidssone/språk, notifikasjoner, avatar, kortfarge):
  lagre på `change`.
- Tekstfelt (bio, lenker): lagre på `blur` + debounce (~800 ms) mens man skriver.
- Vis status med `aria-live="polite"` («Lagrer…», «Lagret», feilmelding fra
  `{ errors }` ved feltet).
- **Tema**: bytt `<link>` til tema-CSS direkte. Merk at critical-CSS-en per tema er
  inline og hash-låst i CSP – det enkleste er å la den stå og bare bytte stylesheet, ev.
  legge temafarger på `data-theme` slik at alt kan byttes uten reload.
- **Tidssone/språk**: tidsstempler må re-formateres – `<time datetime>` finnes allerede,
  så klienten kan formatere på nytt med `Intl.DateTimeFormat`.
- Pass på rate limits (`src/middleware/rate-limit.ts`): autosave sender flere requests
  enn en lagreknapp. Debounce, og vurder romsligere grenser for innstillingsrutene.
- Profilskjemaet er én POST for mange felt (`form`-attributtet binder kortfarge til
  det). Det er greit: send hele skjemaet hver gang.

### 2.2 Ingen navigering ved klikk på kart / munn

`<input type="image">` sender `location.x`/`location.y` og `cut.x`/`cut.y`, og
serveren tar allerede imot nettopp det.

- Lytt på `click` på bildet, regn om `offsetX/offsetY` til bildets *naturlige*
  størrelse (bildet skaleres med CSS på smale skjermer), send
  `location.x`/`location.y` som FormData med fetch.
- Kart: flytt markøren (SVG-sirkelen) og oppdater teksten «Your location: …» fra
  `{ location }`. Tidssonen settes også av serveren – oppdater selecten.
- Munn: oppdater forhåndsvisningen fra `{ avatar }` (rendre `AvatarView` på nytt – et
  godt første eksempel på delt komponent).
- Tastatur: `input type="image"` aktiveres med Enter/Space med koordinat (0,0). Det er
  slik i dag også, men nå er en god anledning til å la piltaster flytte markøren.

### 2.3 Evig scroll

- `IntersectionObserver` på «Older blurts»-lenken. Når den nærmer seg skjermen: hent
  `href` med `Accept: application/json`, rendre kortene, bytt lenken med den nye.
  Lenken blir værende som fallback og for skjermlesere.
- To måter å rendre på:
  1. **JSON + delt `BlurtCard`** (Preact) – krever at malene kan kjøres i nettleseren
     (se §4).
  2. **HTML-fragment**: hent samme URL som HTML, plukk ut kortene med `DOMParser`. Null
     kodedeling nødvendig, fungerer i morgen. Bra som første steg eller fallback.
- `history.replaceState` med `?before=` slik at reload/tilbake ikke mister posisjonen.
  Evig scroll og tilbakeknapp er et klassisk problem – bfcache hjelper, men test det.
- **Footeren blir umulig å nå** (About/Terms/Privacy ligger der). Enten stopp etter
  f.eks. 3 automatiske sider og vis en knapp, eller sørg for at lenkene også finnes i
  aside.
- Discovery-seksjoner kommer bare på første side, så de er ikke et problem her.
- Fokus og `aria-busy`/live-region: annonser «100 eldre blurts lastet».
- Gjelder også `/:username/`, `/near`, `/search`, `/people`, notifikasjoner og «More
  replies» på trådsider (der det er motsatt retning: `after=`).

### 2.4 Blurten legger seg inn i feeden

- Fang `submit` i composeren, send `FormData` (multipart, også bildet) med
  `Accept: application/json`, få `201` + blurt, rendre `BlurtCard` øverst i feeden og
  tøm textarea. Ved feil: vis `{ errors }` i composeren, slik serveren gjør i dag.
- Sjekk at JSON-svaret har samme form som feed-elementene (avatar, `replies: []`,
  `viewerLikes` osv.) – ellers må POST-ruten returnere en `FeedItem`.
- Svar på trådsider og quote-reblurts: samme mekanisme, men ulik plassering (svaret
  nederst i tråden, quoten … kanskje redirect som i dag).
- Bildeopplasting går via picture-worker og kan ta tid: vis en «tegner bildet…»-tilstand.
- Naturlig utvidelse: «3 nye blurts»-banner øverst når andre poster (via samme
  realtime-kanal som notifikasjonene, §2.5). Ikke sett dem inn automatisk – det får
  innholdet til å hoppe mens man leser.

### 2.5 Notifikasjoner i sanntid – også når man ikke er på siden

To separate mekanismer:

**På siden: Server-Sent Events (SSE)**

- `GET /api/events` (`text/event-stream`) som sender `unread`-tall og ev.
  «nye blurts i feeden». `EventSource` reconnecter av seg selv. Enklere enn WebSockets
  og går gjennom Caddy uten konfig (Caddy flusher event-streams).
- **Fanout mellom instanser**: deploy-dokumentasjonen forutsetter flere instanser.
  Notifikasjonen settes inn av én instans, men brukeren kan være koblet til en annen.
  Bruk Postgres `LISTEN/NOTIFY` (trigger på `notifications`-insert, eller `pg_notify`
  etter insert i `state.ts`).
- ⚠️ **PgBouncer kjører `pool_mode = transaction`**, og der fungerer ikke `LISTEN`.
  Lytteren må ha én egen, direkte tilkobling til Postgres per instans.
- Hver åpen fane er en åpen tilkobling. Med HTTP/2 via Caddy er det greit, men sett en
  grense per bruker og send heartbeat (`:\n\n`) hvert ~25 s.

**Utenfor siden: Web Push + Service Worker**

- Service worker (`/sw.js`, må ligge på rot eller ha `Service-Worker-Allowed`), knapp
  «Varsle meg på denne enheten» under Notifikasjoner. Tillatelse **må** be om fra et
  brukerklikk, aldri ved sidelasting.
- Ny tabell `push_subscriptions (user_id, endpoint, p256dh, auth, created_at)`, ruter
  for å registrere/fjerne, og sletting ved kontosletting og når push-tjenesten svarer
  `404/410`.
- **VAPID**: nøkkelpar i config. `jose` er allerede en avhengighet og kan signere ES256-
  JWT-en VAPID krever.
- **Anbefalt: push uten payload («tickle»)**. Da slipper man aes128gcm-kryptering av
  payload helt (eller `web-push`-pakken), og ingen innhold går via Googles/Apples/
  Mozillas push-servere. Service workeren henter
  `/:username/notifications/` med `Accept: application/json` (cookies følger med) og
  viser `showNotification`. Klikk åpner blurten.
- Push sendes av instansen som setter inn notifikasjonen – trenger ingen fanout. Gjør det
  asynkront (kø/`setImmediate`), ikke i request-transaksjonen.
- **iOS/iPadOS**: Web Push virker bare når siden er lagt til på hjemskjermen. Det krever
  et web app manifest (`/manifest.webmanifest`, ikoner) og `manifest-src 'self'` i CSP.
- Grupper/rate-limit push: 30 likes på ett minutt bør ikke bli 30 pling. Bruk `tag` i
  `showNotification` så de erstatter hverandre.
- Sett badge på app-ikonet med `navigator.setAppBadge(unread)` der det støttes.

## 3. Preact-bundlen (`lebbe/preact-hook-signal-htm-bundle`)

Jeg har sett på repoet (v2.0.2). Det passer godt – én ES-modul, `html` ferdig bundet –
men det er noen ting som må på plass:

| Problem | Hvorfor det betyr noe | Tiltak |
| --- | --- | --- |
| Bygget mot **Preact 10.29**, blurt.trade bruker **Preact 11** | Delte komponenter bør kjøre på samme major på server og klient (Preact 11 har brytende endringer) | Oppgrader bundlen til Preact 11 → v3.0.0 (som README-en selv sier: major følger major) |
| Mangler `hydrate` | Trengs for å ta over server-rendret markup i en øy uten å rendre på nytt | Eksporter fra `preact` |
| Mangler `createContext` | `useContext` er eksportert, men er ubrukelig uten `createContext`. Trengs for å erstatte `pageContext()` (se §4) | Eksporter fra `preact` |
| Ikke minifisert helt (26 kB rå) | Ikke kritisk, ~10 kB gzip | Ev. `@rollup/plugin-terser`, + sourcemap |
| README viser jsdelivr | CSP er `'self'`, og personvernsiden lover ingen tredjeparter | Server filen selv fra `node_modules` (`/static/vendor/preact-bundle@3.0.0.js`, immutable cache) |

Avhengigheten blir `"preact-hook-signal-htm-bundle": "^3.0.0"` i `package.json`, servert
med `express.static` fra `node_modules/preact-hook-signal-htm-bundle/dist`.

### Import map

For at *samme kildefil* skal kunne kjøres på server og i nettleser, må bare specifiers
peke på bundlen i nettleseren:

```html
<script type="importmap">
{ "imports": {
  "preact": "/static/vendor/preact-bundle@3.0.0.js",
  "preact/hooks": "/static/vendor/preact-bundle@3.0.0.js"
} }
</script>
```

- I dag gjør malene `import htm from 'htm'` + `htm.bind(h)` i hver fil. Lag én
  `src/templates/html.ts` som eksporterer `html`; på serveren `htm.bind(h)`, i nettleseren
  peker import mappen den fila til bundlen (som eksporterer `html`).
- Import map er et inline-skript og må inn i CSP med hash, akkurat som critical CSS
  allerede gjøres i `themes.ts`. Innholdet er statisk, så hashen kan beregnes ved oppstart.

## 4. TypeScript: ja

Koden er allerede TypeScript som kjøres med Nodes innebygde type-stripping
(`node src/server.ts`, Node 26). Å bruke JS i nettleseren ville betydd to språk og ingen
deling. Derfor TypeScript også for klientkode.

**Stripping uten byggesteg:**

- Node har `stripTypeScriptTypes()` i `node:module` – samme motor (Amaro/SWC) som Node
  selv bruker. En liten middleware: `GET /static/js/**.ts` → les fil fra `src/`, strip
  typer, cache i minnet (nøkkel: mtime/hash), send som `text/javascript` med ETag.
- **Ingen import-omskriving nødvendig**: nettleseren bryr seg om MIME-typen, ikke
  endelsen. `import { BlurtCard } from './blurt-card.ts'` fungerer i nettleseren så lenge
  serveren svarer med `text/javascript`. Det er det samme som gjør at serverkoden virker.
- Begrensningen er den samme som i dag: bare «erasable syntax» (ingen `enum`,
  `namespace`, parameter properties). Allerede tilfellet i kodebasen.
- I produksjon: strip én gang ved oppstart (eller i Docker-bygget) i stedet for per
  request. Ev. sourcemaps for debugging (stripping bevarer kolonner hvis man velger
  whitespace-erstatning, så sourcemap er nesten unødvendig).
- Alternativ: esbuild som byggesteg med bundling/minifisering. Gir færre requests, men
  bryter med «ingen byggesteg»-prinsippet. Med HTTP/2 og `<link rel="modulepreload">`
  er ubundlede moduler fint for en side av denne størrelsen.

**Observasjon:** det finnes ingen `tsconfig.json` og ingen `tsc --noEmit` i `qa`. Typene
blir altså aldri sjekket, bare strippet. Når kode skal deles mellom to miljøer blir
typesjekk mye mer verdt (den fanger f.eks. at en delt komponent importerer
`node:crypto`). Anbefaler å legge til `tsc --noEmit` med `"lib": ["dom", ...]` for
klientmappa.

## 5. Gjenbruk av kode

Ja, komponentene kan gjenbrukes – men **ikke slik de ligger i dag**. Avhengighetsgrafen
fra `src/templates/index.ts` drar med seg ting som ikke kan kjøres i nettleseren:

| Avhengighet | Brukes til | Problem i nettleser | Løsning |
| --- | --- | --- | --- |
| `pageContext()` (AsyncLocalStorage) | viewer, tidssone, locale, tema, unread i bl.a. `Timestamp` | Node-API | Preact `createContext` + Provider på serveren og i hver øy. Klienten får verdiene fra et `<script type="application/json">` (kjøres ikke, CSP-trygt) |
| `../og.ts` (`node:crypto`, `fs`) | `blurtCardPath`/`ogHash` i `BlurtCard` | Node-API, og SubtleCrypto er async | Beregn kort-URL på serveren og legg den i dataene (`blurt.cardPath`) |
| `../limits.ts` (importerer `zod`) | bare tall som `blurtMaxLength` | Drar med zod | Skill konstanter fra zod-skjemaer |
| `../timezones.ts` (`tz-lookup`) | `formatTimestamp` | Stor avhengighet for én ren `Intl`-funksjon | Skill formatering fra oppslag |
| `../config.ts` (`process.env`) | `publicUrl`, `contact` | Node-API | Kun i server-meta (`Head`), ikke i kort; hold det utenfor delte filer |
| `../themes.ts` (`node:crypto`) | temaliste | Node-API | Skill data (id/label) fra hash-beregning |
| `../routes/state.ts` | bare `import type` | Ingen – typer strippes | OK |

**Delbart med moderat innsats:** `BlurtCard` og barna (`Likes`, `Reblurts`, `Timestamp`,
`QuotedCard`, `ReplyingTo`, `DeleteForm`, `ReportForm`), `AvatarSvg`/`AvatarView`,
`Icon`, `renderBlurtText`, `Discovery`, `NotificationItem`, `UnreadBadge`, URL-hjelperne
(`blurtUrl`, `olderBlurtsUrl` …).

**Ikke verdt å dele:** hele sider (`FeedPage`, `ProfilePage` …), `Head`/`renderDocument`,
markdown-malene. Sidene rendres alltid på serveren.

**Lås grensen med verktøy**, ellers sniker en `node:`-import seg inn igjen:

- oxlint `no-restricted-imports` for den delte mappa (forby `node:*`, `zod`, `tz-lookup`,
  `page-context`, `config`).
- En test som starter Playwright (finnes i miljøet), laster hver delt modul via
  stripping-middlewaren og sjekker at den importerer uten feil.
- En test som rendrer `BlurtCard` på server og i nettleser med samme data og
  sammenligner HTML.

Ekstra gevinst: likes/reblurts/follow/delete/report kan da også gjøres uten reload –
send formen med fetch, rendre kortet på nytt med det nye svaret.

## 6. Refaktorering først? Ja – men to steg, og grensen viktigere enn mappene

_Merknad: steg 2 er gjort (#37) – sidene ligger nå i én mappe per side under `src/pages/`; stiene under er slik de var da evalueringen ble skrevet._

`src/templates/index.ts` er 2862 linjer, `pages.md.ts` 872 og `routes/state.ts` 1645.
Det er tungt å navigere i uansett, og med klientkode blir det verre.

**Steg 1 (det som faktisk blokkerer JS): skill isomorf fra server-only.**
Rydd avhengighetene i tabellen over, innfør `html.ts` og `createContext`. Dette er en ren
flytting/oppsplitting uten endret oppførsel.

**Steg 2: én mappe per side/komponent.** Forslaget ditt er godt, med én justering:
JSON er ikke en mal (det er bare dataene), så filene per mappe blir *typer/hjelpere*,
*html*, *markdown* og ev. *klient*:

```
src/
  ui/                       # isomorft: kjører på server og i nettleser
    html.ts                 # export const html = htm.bind(h)
    context.ts              # createContext for viewer/tidssone/locale
    blurt-card/
      blurt-card.ts         # BlurtCard + Likes, Reblurts, QuotedCard …
      blurt-card.md.ts      # markdown-varianten (server-only)
      blurt-card.client.ts  # like/reblurt uten reload
    avatar/  icons/  timestamp/  notification-item/
  pages/                    # server-only
    feed/
      data.ts               # FeedData, feedPath, olderBlurtsUrl
      feed.html.ts
      feed.md.ts
      feed.client.ts        # evig scroll, composer
    profile-edit/
      ...
      profile-edit.client.ts  # autosave, kart, munn
    blurt/  profile/  notifications/  search/  near/  people/  settings/  info/  admin/
  client/
    main.ts                 # finner data-enhance og laster modulene
    sw.ts                   # service worker
```

Fordeler: alt om én side ligger samlet; HTML og Markdown for samme side ligger ved siden
av hverandre (lettere å holde dem i takt); klientkoden har en naturlig plass;
`ui/` vs `pages/` gjør grensen synlig og lintbar.

Råd for gjennomføringen:

- **Egen PR, kun flytting.** Ingen endret oppførsel. Før du begynner: lag en test som
  rendrer alle sider (HTML og Markdown) med faste data og lagrer resultatet; etter
  flytting skal output være byte-identisk. `representations.test.ts` m.fl. dekker mye,
  men en snapshot gjør det trygt.
- Ikke del opp for fint – 25–35 filer, ikke 120. Små hjelpekomponenter som bare brukes
  ett sted bor i filen til den som bruker dem.
- `routes/state.ts` (1645 linjer) er ikke i veien for JS, men kan deles per domene
  (`blurts`, `notifications`, `profiles` …) i samme slengen eller senere.

## 7. Ting du kanskje ikke har tenkt på

**Sikkerhet og CSP** (`src/middleware/security-headers.ts`)

- Policyen har i dag *ingen* `script-src` (alt blokkert). Trenger
  `script-src 'self' 'sha256-<importmap>'`, `worker-src 'self'`,
  `manifest-src 'self'`. `connect-src 'self'` finnes allerede. Ikke bruk
  `'unsafe-inline'` – data til øyer sendes som `type="application/json"`.
- Kommentaren i fila og i `docs/routes.md` sier eksplisitt at sidene ikke har JS – må
  oppdateres.
- CSRF: i dag beskytter SameSite=Lax + `form-action 'self'`. fetch fra egen origin er
  like trygt, men vurder en `Origin`-sjekk på POST når siden først har JS (billig
  forsvar i dybden).
- Med JS på siden blir XSS mye farligere enn i dag (i dag kan injisert markup ikke kjøre
  noe takket være CSP). Preact escaper, men `dangerouslySetInnerHTML` og
  `renderBlurtText` bør gjennomgås. Hold CSP stram.

**Tekst og løfter til brukerne**

- About, forsiden («No ads, no tracking, no JavaScript») og personvernsiden («The site
  uses no JavaScript, so nothing is stored in your browser in any other way») lover *ingen
  JS*. Det må skrives om, og personvernsiden må nevne service worker, cache, push-
  abonnement (endpoint lagres på serveren, går via nettleserleverandørens push-tjeneste)
  og ev. `localStorage`.
- Opt-out-innstillingen er et godt salgsargument: «Fungerer helt uten JavaScript – slå
  det av her.»

**Ting som gir smoothere opplevelse helt uten JS** (kan gjøres først, gratis)

- **Cross-document View Transitions**: `@view-transition { navigation: auto; }` i CSS gir
  myke overganger mellom sider ved vanlig navigering. Null JS.
- **Speculation Rules** for prefetch/prerender av lenker ved hover kan leveres som
  `Speculation-Rules`-HTTP-header som peker på en JSON-fil – ingen skript, ingen CSP-hash.
  Gjør navigeringen nesten øyeblikkelig.
- Sørg for at sidene er **bfcache**-vennlige (ingen `Cache-Control: no-store` på
  HTML der det ikke trengs), så tilbakeknappen er øyeblikkelig.
- Etter POST-redirect: scroll til riktig sted (anker finnes allerede for likes).

**Flere JS-forbedringer**

- Likes, reblurts, follow, delete og report uten reload (optimistisk oppdatering).
- Tegnteller i composeren, `Ctrl/Cmd+Enter` for å sende, utkast i `localStorage` (husk
  personvernsiden).
- Forhåndsvisning av bilde før opplasting, og nedskalering i nettleseren før upload
  (mindre data, raskere picture-worker).
- Relative tidsstempler («5 min siden») som oppdaterer seg, med `<time datetime>` som
  allerede finnes.
- Svar inline i feeden uten å gå til trådsiden.
- «Del»-knapp med `navigator.share()` – kommentaren ved `ShareLink` peker allerede dit.
- Live søk mens man skriver (debounce, rate limit finnes allerede for `/search`).
- Bekreftelsesdialog (`<dialog>`) ved sletting.

**Kvalitet og drift**

- **Test begge modusene**: Playwright med `javaScriptEnabled: false` og `true` på de
  samme flytene. Det er den eneste måten å holde «alt skal fungere uten JS» sant over tid.
- Feilhåndtering som prinsipp: hver enhancer skal ved nettverksfeil/ukjent svar la den
  opprinnelige handlingen skje (`form.submit()` / følg lenken).
- Tilgjengelighet: `aria-live` for lagret-status og lastet innhold, fokus etter at
  blurt er postet, `prefers-reduced-motion`.
- Cache-busting: versjonér URL-er (`/static/js/<hash>/…`) eller ETag, ellers får brukere
  gammel klientkode mot ny server etter deploy. Service workeren gjør dette ekstra
  viktig – SW-en må oppdatere seg (`skipWaiting`) og ikke cache HTML aggressivt.
- Klient og server i takt under rullerende deploy: klienten bør tåle at et JSON-felt
  mangler/er nytt.
- Logging: vurder et lite endepunkt for klientfeil (`window.onerror`) – eller la være,
  av personvernhensyn. Bevisst valg.

## 8. Foreslått rekkefølge

1. **Gratis smoothness uten JS**: View Transitions + Speculation Rules. (Liten, ingen
   risiko.)
2. **Refaktorering steg 1**: isomorf/server-grense, `html.ts`, `createContext`, data
   som `cardPath` beregnet på serveren. Snapshot-test.
3. **Bundlen v3**: Preact 11, `hydrate`, `createContext`, publiser på npm.
4. **Infrastruktur**: stripping-middleware, import map + CSP, opt-out-innstilling,
   `main.ts` med `data-enhance`, Playwright med JS av/på, oppdaterte tekster.
5. **Punkt 1 og 2** (autosave, kart, munn) – lite delt kode, god test av infrastrukturen.
6. **Refaktorering steg 2** (mappe per side) – kan også gjøres før 5.
7. **Punkt 4 og 3** (blurt inn i feed, evig scroll) – første reelle bruk av delt
   `BlurtCard`. Likes/reblurts uten reload kommer nesten gratis.
8. **Punkt 5**: SSE med LISTEN/NOTIFY (egen tilkobling forbi PgBouncer), så Web Push
   med VAPID via `jose`, payload-løs push, manifest for iOS.
