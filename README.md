# DhakaDrive-VQA annotation platform

A web app for writing and cross-checking the DhakaDrive-VQA benchmark questions. Annotators upload traffic scenes and write multiple-choice questions on the topics they're given; other annotators then check them without seeing the setter's answer first. The admin runs everything: accounts, the taxonomy, sprints, the model check, statistics and export.

It runs as one Next.js app on Vercel, with Postgres on Supabase and images on Cloudinary. Live at `dhakavqa.triips.org`.

---

## How it works

### Roles

| | |
| --- | --- |
| **Admin** (one fixed account) | Creates and revokes annotator accounts and resets their passwords; edits the taxonomy and scene tags; runs sprints; settles flagged questions; runs the model check; sees all statistics; exports. |
| **Annotator** | Signs in with the username and password the admin issued. Writes questions on assigned topics; checks other people's questions during verification. |

There is no sign-up and annotators can't change their own password. A new password is shown to the admin once, with a copy button, and stored only as a hash.

### A sprint

1. **Set up** — the admin assigns each annotator a whole type or specific subtypes, with a target count.
2. **Write** — annotators upload images (tagged with view, time of day, weather, density, location) and write questions with 2–5 options and the correct one marked.
3. **Start verification** — the admin draws two checkers per topic (people who didn't write in it, balanced by workload, swappable), then starts verification. Writing locks.
4. **Check** — every checker answers **blind** first. What happens next depends on the subtype's verifiability:

   | | Checkers | After the blind answer | Accepted when |
   | --- | --- | --- | --- |
   | **V** verifiable | 1 (V questions are split between the topic's two checkers) | If it differs from the setter's, they see the setter's answer and say "the setter made a mistake" or "I misread it" | the answers match, or they misread |
   | **C** consensus | 2, both blind throughout | nothing more | all three pick the same option |
   | **I** inferential | 2, in turn | **second** sees the setter's answer and agrees or disagrees; **third** sees both and says whether all three agree | both say yes |

   Anything else is **flagged** for the admin. Every checking screen also offers *None of these is correct* and *Can't tell from the image*, and options are shuffled for every checker and model.
5. **Model check** — the admin draws a sample (10% by default, at least one per subtype) and gets model answers by API or records them by hand (see [Models](#models)).
6. **Review and close** — the admin accepts, fixes, sends back or drops flagged questions (a drop needs a reason, which the setter sees), closes the sprint and exports.

Setters can keep improving their own questions until one is accepted. Editing a question that's being checked or is flagged resubmits it: the answers so far are cleared (and kept in the question's history) and the same checkers answer it again on fresh tasks. After verification has ended, the edit goes to the admin instead. A question the admin sent back or dropped is fixed and then sent back to the admin.

### Question codes

Every question has a code like `07-1.4-003`: setter **07** (annotators are numbered in the order they were created, shown on the Annotators page), subtype **1.4**, and that setter's **3rd** question in the subtype. The database assigns it, so codes never repeat, even after a question is deleted. Moving a question to another subtype gives it a new code (the old one is kept in its history); a question whose subtype is deleted keeps its code while it waits in Uncategorised. The admin's question search accepts a code or the start of one (`07-1.4`). Checkers never see codes, since they name the setter.

### Taxonomy

8 types and 41 subtypes, seeded from the team's category list (`db/migrations/0002_seed_taxonomy.sql`). The admin edits everything on the Taxonomy page: types, subtypes, their verifiability, and scene tag groups. A question keeps the verifiability it was written with, so editing a subtype never changes how existing questions are checked. Hiding a subtype keeps it out of annotators' way; deleting one moves its questions (and any topic assigned to it) to a built-in **Uncategorised** type, where each question remembers its old subtype until the admin files it under a new one from the question's page. A type can be deleted once its subtypes are gone. All questions are multiple choice.

### Models

The Models page holds the proposal's catalogue: 74 models (35 proprietary, 32 open-weight, 7 driving-specific), 29 of them funded, with their prices. Everything about them is editable. Deleting a model also deletes the answers recorded for it; to retire a model but keep its answers, untick *In use* instead.

A model is **asked by API** when it's linked to an **API connection** and has its provider model ID; any other model is **answered by hand** (run it anywhere, record the letter it chose). Connections come in three types:

| Type | Covers |
| --- | --- |
| Anthropic | Claude models, through the official SDK |
| Google Gemini | Gemini models |
| OpenAI-compatible | OpenAI, xAI, Mistral, Alibaba (Qwen), Moonshot (Kimi), Z.ai (GLM), DeepSeek, ByteDance, Baidu, Cohere, OpenRouter — and open-weight models you serve yourself on a GPU with vLLM, SGLang or Ollama |

The admin adds a connection with its API key; the key is encrypted with `ENCRYPTION_KEY` and never shown again. "Test key and list model IDs" checks it and lists the exact IDs to paste into each model. Per-model request options (JSON, e.g. `{"reasoning_effort": "high"}`) are merged into every request so settings stay fixed across the run; they can't change the model, prompt or image. Every API answer records its option order, tokens and time, and the Models page shows spend per model against the listed prices.

On the model check page, each API model has a runner that asks every unanswered sample question from the browser, three at a time. Each request is a single question, so slow models never hit Vercel's time limit, and stopping or closing the tab simply stops the run.

---

## Local development

Requires **Node 20.12+**. No Docker needed: a real Postgres 17 runs from `node_modules`.

```bash
npm install
cp .env.example .env.local      # then set ADMIN_PASSWORD (10+ characters)
```

In one terminal, start the database (data lives in `.pgdata/`):

```bash
npm run db:dev
```

In another, create the tables and the admin account, then start the app:

```bash
npm run db:migrate
npm run dev
```

Open http://localhost:3000 and sign in as the admin. With no Cloudinary keys set, images are stored in `.uploads/`.

To try the annotator side quickly, seed four sample annotators and a sprint in its writing stage (local databases only):

```bash
DEV_SEED_PASSWORD=some-long-password npm run db:seed-dev
```

Or, to try verification straight away, a sprint whose questions are all written already (16 questions on generated test images, ready for the admin to draw checkers and start verification):

```bash
npm run db:seed-dev -- --ready-to-check
```

Tests (`npm test`) cover the checking rules, the checker draw, the agreement statistics, and an end-to-end sprint against a throwaway database (start `npm run db:dev` first; without it that file is skipped).

---

## Deploying

### 1. Supabase (database)

Create a project. Under **Project Settings → Database → Connection string**, copy the **Transaction pooler** string (port 6543) with your database password filled in. That's `DATABASE_URL`.

Only our server talks to the database. Every table has row-level security on with no policies, so Supabase's public API can't read anything even with the anon key.

### 2. Cloudinary (images)

From **Settings → API Keys**: the cloud name, API key and API secret. Images are uploaded as *authenticated* assets — nothing is reachable without a URL our server signed.

### 3. Vercel (the app)

Import the GitHub repository. Under **Settings → Environment Variables**, set:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the Supabase transaction pooler string |
| `ADMIN_USERNAME` | the admin's username, e.g. `admin` |
| `ADMIN_PASSWORD` | the admin's first password (10+ characters) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | from Cloudinary |
| `ENCRYPTION_KEY` | 32 random bytes, base64 (command in `.env.example`); encrypts the provider API keys added on the Models page |

The build runs the database migrations first (`npm run build`), so every deploy brings the schema up to date, and the first one creates the admin account. Under **Settings → Functions**, set the region closest to the Supabase project's region, since every page makes several database queries.

### 4. Domain

In Vercel, **Settings → Domains → Add** `dhakavqa.triips.org`. Vercel shows a CNAME record to create. **Add it in Cloudflare**, which hosts triips.org's DNS (a record added in cPanel has no effect), with the proxy set to *DNS only*.

### 5. Backups

`.github/workflows/backup.yml` dumps the database every night, encrypts it, and keeps it as a workflow artifact for 30 days. Add two repository secrets: `BACKUP_DATABASE_URL` (Supabase's **Session pooler** string, port 5432) and `BACKUP_PASSPHRASE` (keep a copy somewhere safe). Run it once by hand from the Actions tab to check it. Restore instructions are at the top of the workflow file.

Images live on Cloudinary; keep the source footage as the master copy.

### Admin password recovery

The admin can change their password on the account page. If it's lost, set a new `ADMIN_PASSWORD` and run, against the production `DATABASE_URL`:

```bash
npm run db:migrate -- --reset-admin
```

---

## Security notes

- Passwords: scrypt hashes; sign-in locks for 15 minutes after 5 failures; sessions are stored in the database, so revoking someone or resetting their password signs them out at once.
- Every page and server action checks the session and role on the server. Checkers are never sent answers they aren't allowed to see yet.
- Uploads go straight from the browser to Cloudinary with a short-lived signature (Vercel limits request bodies to 4.5 MB); the server verifies Cloudinary's signed response before recording an image.
- Admin actions and exports are logged (Admin → account page). Exports contain signed image links: keep them private.
- Strict security headers and a Content Security Policy are set in `next.config.ts`.

## Layout

```
db/migrations/        schema and seed data, applied in order by scripts/migrate.ts
scripts/              migrate, local database, dev seed
src/server/           everything that touches data: auth, sprints, questions, checks, stats, storage, models, export
src/server/engine.ts  the checking rules (pure, unit-tested)
src/app/              pages: annotator ( /, /write, /questions, /check ) and admin ( /admin/... )
tests/                unit tests and the end-to-end workflow test
```

## Licence

MIT — see [LICENSE](LICENSE).
