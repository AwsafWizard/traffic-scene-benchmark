# Traffic Scene Benchmark

Benchmarks LLMs on spatial, logical, and behavioral questions about traffic and road scenes —
measured against a human baseline rather than against a score in isolation.

The loop is: **set a question → a human answers it blind → the models answer it → compare.**
Because the human answers before seeing anything else, you learn two things at once: how the
models perform, and whether the question was any good. A question every model aces tells you
nothing. A question humans find unanswerable is a broken question, not a hard one.

Everything runs locally — Next.js and SQLite, with your images and answers on disk in `data/`.
Nothing leaves your machine except the model API calls you explicitly trigger, and whatever you
choose to sync with a partner.

---

## Quick start

Requires **Node 20+**.

```bash
npm install
npm run dev
```

Open http://localhost:3000. That's enough to start writing questions and answering them — API
keys are only needed when you want models to answer too.

<details>
<summary>If your system Node is older than 20</summary>

`./dev.sh dev` sources nvm, selects Node 20, and puts it first on `PATH` before starting the
dev server — Turbopack spawns child `node` processes, so launching a newer binary directly
isn't enough. If you've ever started the app under an older Node, delete `.next/` first; the
stale chunks keep failing otherwise.

</details>

### API keys

Keys go in `.env.local` at the project root — **never into the app's UI**. Fill in only the
providers you want, then restart the dev server. The Models page shows which keys it can see.

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
```

`GEMINI_API_KEY` works as an alias for `GOOGLE_API_KEY`. The file is gitignored and the keys
are only ever read server-side, so they never reach the browser.

### Finding model IDs

Model IDs change often, so ask your own account instead of guessing:

```bash
npm run models
```

This prints the exact model strings each of your keys can see. Paste one into **Model ID** on
the Models page. The model must accept image input.

---

## The workflow

1. **Add question** — upload a scene, write the question, tag it spatial / logical /
   behavioral, and pick multiple-choice or free text. A reference answer is optional for free
   text; for multiple choice it enables automatic scoring.
2. **Ground** — the human sees only the image and the question. Never the reference answer,
   never the model answers. They give an answer, a confidence rating, and optionally their
   reasoning.
3. **Compare** — once they've answered, everything is revealed. Run the models from here, then
   grade each answer correct / partial / incorrect. Multiple choice is graded automatically;
   free text you grade yourself.
4. **Results** — accuracy per model, split by category, with the human row alongside.

### Reading the question-quality table

The second table on Results is about your *questions*, not the models:

| Flag | Meaning |
| --- | --- |
| **discriminative** | Humans got it right, models got it wrong. This is the question you want more of. |
| **too easy** | Every model got it right — no signal. |
| **ambiguous** | Grounders disagreed with each other. Usually the question needs rewriting, not the model. |
| **hard for humans** | Humans got it wrong, so the reference answer or the image may be the problem. |

The `gap` column is human accuracy minus model accuracy. The higher it is, the more that
question is actually measuring something.

---

## Working with a partner

One person writes questions, another answers them cold. Four ways to arrange that, best first.

### Cloud sync — recommended

Both of you run your own copy; they trade work through a free Supabase bucket. Nothing else to
install, and it keeps working while the other machine is asleep.

**One of you** sets this up once:

1. Create a free project at [supabase.com](https://supabase.com) — no card needed.
2. **Storage → New bucket**, named exactly `traffic-bench`, left private.
3. **SQL Editor**, run this so both copies can read and write it:

   ```sql
   create policy "bench read"   on storage.objects for select
     using (bucket_id = 'traffic-bench');
   create policy "bench insert" on storage.objects for insert
     with check (bucket_id = 'traffic-bench');
   create policy "bench update" on storage.objects for update
     using (bucket_id = 'traffic-bench');
   ```

4. **Project Settings → API**, copy the **Project URL** and the **`anon` `public`** key. Not
   `service_role` — that one bypasses every rule above.

**Both of you** put those same two values in your own `.env.local`, restart the dev server, and
pick **Cloud (Supabase)** on the Transfer page:

```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

That's the whole setup. Your partner needs no Supabase account — just the repo, Node, and those
two strings. The Transfer page walks through it again in-app if you get stuck.

> Anyone holding those two values can read and write the bucket, so treat the anon key as a
> shared password and keep the bucket private.

### Shared folder

Prefer to keep data off a third-party service? Point both copies at a folder something else
mirrors — Dropbox, Syncthing, or Google Drive — and set that path on the Transfer page.

**Google Drive on Linux is the awkward case.** Google ships no Drive client for Linux, and
connecting Drive through GNOME Online Accounts does *not* work: that mount lists files by
opaque ID rather than name, so the app can't find the bundles. Use [rclone](https://rclone.org),
which `scripts/drive-sync.sh` wraps:

```bash
curl https://rclone.org/install.sh | sudo bash   # once
./scripts/drive-sync.sh setup                    # authorise your Google account
./scripts/drive-sync.sh start                    # sync every 20s in the background
```

On Windows and macOS, Google Drive for Desktop handles it with no extra tooling — point the app
at `G:\My Drive\traffic-bench` or the equivalent.

### A link on the same network

If you're in the same room, skip sync entirely. The **Share** page gives a link that puts your
partner's browser into grounding mode against *your* running app — nothing for them to install.
Works while your machine is awake and on the same network.

### Passing files by hand

The Transfer page exports and imports bundles directly, with no sync configured at all. Useful
for a one-off, or for taking a snapshot elsewhere.

### How sync works

Each copy writes two files named after its own install id, and never touches anyone else's:

```
questions-<id>.json    questions that copy created, with images embedded
answers-<id>.json      that copy's answers and its grounder comments
```

Imports are keyed by a stable per-question id and are idempotent, so both sides converge
whatever order things arrive in, and importing the same bundle twice changes nothing. Rows that
arrive from elsewhere are flagged and never re-published, so the bucket doesn't fill with copies
of copies. Bundles are only rewritten when their content actually changes, so two idle installs
generate no traffic.

Pushes happen the moment a question, answer, or comment is saved; each copy also pulls every 30
seconds while a tab is open. It's eventual, not instant.

**Your reference answers and private notes are never uploaded** — only questions, answers, and
grounder comments. Handing someone the bucket can't spoil their grounding.

---

## Being both setter and grounder

There's no mode to switch. Whether you're answering blind is decided per question, by who wrote
it:

| | Reference & model answers | Your comments |
| --- | --- | --- |
| **A question you wrote** | Visible — you wrote the answer key | Private note, stays on your machine |
| **A question your partner wrote** | Hidden until you've answered it | Feedback, travels back to them |

So you can both write questions and ground each other's with nothing to remember. Opening
Compare on a partner's question you haven't answered sends you to the grounding page instead.

The **Answer only** setting on the Transfer page is for a dedicated grounder's machine, which
should never see answers even for questions written there.

## Comments

Either side can leave notes on a question — the grounder flagging that an image is too small or
the wording is ambiguous, the setter keeping notes on whether a question earns its place.

A grounder never sees the setter's notes; those could give away the intended answer. Grounder
comments travel back with their answers and show on the Compare page with a
**"grounder flagged this"** marker, so a question your partner struggled with is visible right
next to the results.

---

## Models

Add any number, from any provider, on the Models page. You supply the exact API model string;
nothing is hardcoded.

| Field | What it is |
| --- | --- |
| **Display name** | The label in the results tables, e.g. `Gemini 2.5 Pro`. Yours to choose. |
| **Provider** | Which API to call, or **Manual** for a model you run elsewhere. |
| **Model ID** | The exact API model string, from `npm run models`. |
| **Short name** | Internal identifier, defaults to the Model ID. **Not an API key.** |
| **Extra request params** | JSON merged into the API call — pin `temperature` here so runs stay comparable. |

Only enabled models run. Disabling one keeps its past results in the tables.

### Answers you got elsewhere

For a model you have no API key for — a chat UI, something behind a paywall — add it with
provider **Manual**, then use **"Paste an answer by hand"** on the Compare page. Pasted answers
are scored like any other and carry a **PASTED** badge so you can tell them apart later. Manual
models are skipped when you run models, rather than failing.

### Follow-up threads

Under any model answer, **Ask a follow-up** starts a conversation with that model about its own
answer — the image and the full thread go back each turn, so you can push on shaky reasoning
("what makes you say the van is indicating?").

Follow-ups reply in prose rather than the scored JSON format, and don't change the original
answer or its grade. For manual models you paste the reply in alongside your question.

---

## Notes

- Data lives in `data/` — SQLite plus uploaded images. It's gitignored, so cloning this repo
  gives you the tool and none of the data. Back it up yourself if the answers matter.
- Model calls run in parallel, and failures are recorded per model rather than failing the whole
  run, so one bad key doesn't lose the others' answers.
- Every run is stored, so re-running a question keeps the history; Compare shows the most recent
  answer per model.
- Schema changes migrate on startup, so after pulling an update **restart the dev server** — hot
  reload keeps the old database connection and you'll see "no such column" until you do.

## Licence

MIT — see [LICENSE](LICENSE).
