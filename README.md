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

Open http://localhost:3000. That's everything — there are no API keys to configure, because
model answers are run wherever you like and pasted in.

<details>
<summary>If your system Node is older than 20</summary>

`./dev.sh dev` sources nvm, selects Node 20, and puts it first on `PATH` before starting the
dev server — Turbopack spawns child `node` processes, so launching a newer binary directly
isn't enough. If you've ever started the app under an older Node, delete `.next/` first; the
stale chunks keep failing otherwise.

</details>

### Sharing a project

Nothing else is needed to work alone. To work with someone else, see
[Working with a partner](#working-with-a-partner) — one shared setting, no accounts for them.

---

## The workflow

1. **Add question** — upload a scene, write the question, and pick its fine-grained taxonomy
   type. The type decides the rest: how checkable the answer is, whether a frame is enough,
   which grounding probes apply, and how it's scored. Every default stays editable.
2. **Ground** — the human sees only the image and the question. Never the reference answer,
   never the model answers. They give an answer, a confidence rating, and optionally their
   reasoning. Once they submit, the same Compare page opens for them as for you.
3. **Compare** — once they've answered, everything is revealed. Paste in what each model said,
   then grade it correct / partial / incorrect. Formats with a reproducible check score
   themselves; the rest you grade.
4. **Statistics** — what the benchmark covers, how each model does across it, and which
   individual questions are earning their place.

### The taxonomy

Questions are classified on two levels: one of six **dimensions**, then a **fine-grained type**
within it — 27 in all, from *object existence (hallucination trap)* to *informal-behaviour
reasoning*. Types marked ★ are ones that only arise in South Asian traffic, or that it makes
much harder.

Each type carries three labels:

| | Meaning |
| --- | --- |
| **V** verifiable | Readable straight from the pixels; annotators will agree. |
| **C** context / consensus | Verifiable once you state a rule or take a majority vote. |
| **I** inferential | Prediction or intention — score the reasoning, not a ground truth. |

plus a **modality** (single frame, or needs a clip) and a set of **grounding probes** — BLANK,
NO-IMG, SWAP, CF, LOC, OCR — the checks that tell genuine visual reading from a language prior.

Answer formats replace the old multiple-choice/free-text split with nine codes: `BIN`, `MCQ`,
`MSEL`, `NUM`, `SA`, `GND`, `RANK`, `STR`, `FT`. Five of them score automatically —
binary, multiple choice and short answer by normalised match, numeric with an off-by-k
tolerance, multi-select by set overlap (which is what returns a *partial*). Grounded, ranking,
structured and free-text answers need a human or a rubric, so the app leaves them to you.

### Questions written before the taxonomy

Their answer format carried over exactly — `mcq` became `MCQ`, free text became `FT`, so
nothing changed about how they're scored. The fine-grained type can't be inferred from
"spatial / logical / behavioral", so it was left empty rather than guessed. The **Classify**
page walks through them one at a time with the dimension pre-selected from the old label.
Unclassified questions keep grounding, running and scoring as before; they just sit out the
per-dimension results.

## Statistics

The **Statistics** tab is the overall picture:

- **What has been asked** — questions by dimension, by verifiability, by modality, by answer
  format, plus how much of the 27-type taxonomy has any question at all.
- **How the models are doing** — accuracy per model across the six dimensions, then split by
  verifiability and by answer format, with the human baseline on top. Every rate reads as
  `accuracy / answers graded`, so you can see how much it rests on.
- **Per fine-grained type** — human versus model accuracy and the gap between them.
- **Per question** — human versus model on each individual question, with a signal flag.
- **Types with no questions yet** — the gaps in coverage, listed so you know what to write next.

Ungraded answers are excluded from every rate rather than counted as wrong, and the count of
them is shown up top so a thin number never looks solid.

### Reading the signal flags

The per-question table is about your *questions*, not the models:

| Flag | Meaning |
| --- | --- |
| **discriminative** | Humans got it right, models got it wrong. This is the question you want more of. |
| **too easy** | Every model got it right — no signal. |
| **ambiguous** | Grounders disagreed with each other. Usually the question needs rewriting, not the model. |
| **hard for humans** | Humans got it wrong, so the reference answer or the image may be the problem. |

The `gap` column is human accuracy minus model accuracy. The higher it is, the more that
question is actually measuring something. A large *negative* gap is worth a look too — it
usually means the reference answer is wrong rather than that models beat your grounder.

---

## Working with a partner

One person writes questions, another answers them cold. Three ways to arrange that, best first.

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

### A second copy, for testing sync

Rather than asking your partner whether a change landed, run a second copy here and watch both
sides yourself. It's the same app out of the same checkout — nothing is cut down or put in a
special mode — with its own database, its own images and its own install id, so the two behave
as two machines:

```bash
npm run dev:partner
```

That serves the second copy on <http://localhost:3001>, keeping its data in `data-partner/`
(both it and its build directory are gitignored). Your own copy on port 3000 is untouched.
Open them side by side and you can add a question in one, watch it arrive in the other, answer
it there, and see the answer come back.

It starts with sync **off** — set a mode on its Transfer page, the same way your partner set
theirs. Which target to point it at:

- **Same bucket as your partner** — the honest end-to-end test of your real setup, but
  everything you do in the second copy is real work arriving on their side. Good for a
  deliberate round trip, not for poking around.
- **A sandbox bucket** — `SUPABASE_BUCKET=traffic-bench-test npm run dev:partner` exercises the
  same cloud path with nothing shared. The usual choice.
- **Folder mode** — point both copies at one scratch directory to test the whole loop offline.

Each copy publishes only what it creates itself: rows that arrived from elsewhere are flagged
as imported and never republished, so the second copy can't echo your questions back at you.

To start it over, stop it and delete `data-partner/`. The next run rebuilds it empty with a
fresh install id.

### Passing files by hand

The Transfer page exports and imports bundles directly, with no sync configured at all. Useful
for a one-off, or for taking a snapshot elsewhere.

### How sync works

Questions go one per file, keyed by the question's own id; answers stay in a single per-install
file, since they carry no images and are tiny:

```
q/<question-id>.json   one question, image embedded
answers-<id>.json      that copy's human answers, model answers and comments
```

Splitting questions matters more than it looks. With everything in one bundle, adding a
question rewrote a file carrying every image ever added — so the upload grew with the
collection, and a free Supabase project would have hit its ~50 MB per-file ceiling at roughly
25 questions. One file per question keeps each upload the size of that question.

Imports are keyed by that id and are idempotent, so both sides converge whatever order things
arrive in, and importing the same file twice changes nothing. Each copy publishes everything it
holds, not only what it typed itself — an answer that reached you as a hand-imported bundle, or
a grade you gave your partner's answer, would otherwise live on one machine and nowhere else.
Because a question's file is keyed by its own id, re-publishing rewrites that one file instead
of adding a copy of it. Files are only rewritten when their content actually changes, so two
idle installs generate no traffic.

**Edits travel, not just new rows.** Classifying a question your partner wrote reaches them;
so does a corrected prompt. Each question carries the time it was last edited, and a copy
receiving one reconciles it field by field:

- A filled-in value beats an empty one, whichever side is newer. Your classification can't be
  blanked out by a copy that simply never had one.
- When both sides have a value and they differ, the more recent edit wins.
- Edits made in the same second are settled by comparing the content itself, so both machines
  reach the same answer rather than each keeping its own.

A grade is treated as the grader's own: an incoming one fills a gap, and never overwrites a
verdict you gave yourself. If the two of you disagree, you each keep your own.

Pushes happen the moment a question, answer, or comment is saved; each copy also pulls every 30
seconds while a tab is open. It's eventual, not instant.

The model roster travels as well, so both copies benchmark the same set. Models arriving from
the other side are added **disabled** — nothing is ever called without your own key, and API
keys are never in the bundle since each install reads its own from `.env.local`.

Model answers travel too, including ones pasted by hand, their follow-up threads, and the grade
you gave them — so do the grades on human answers, so both of you see the same Statistics. A model the other side used but you
haven't configured is registered here as a disabled entry, so its answers are labelled properly
and it is never called. If a copy's remote file goes missing or is emptied, the next sync
notices and republishes it.

The first sync after upgrading to edit-aware sync re-publishes every question this copy holds,
once, so the bucket carries each side's current version rather than only the rows it first
wrote. Expect one slow sync per install; after that the hash check keeps it quiet again.

**The answer key travels; your private notes don't.** Both copies hold the same reference
answer, so whoever grounded a question sees what it was meant to be once they have answered,
and each copy can score the checkable formats for itself rather than waiting for the other to
grade. What protects grounding is not the key being absent — it's that Compare refuses to open
a question this copy hasn't answered yet, and sends you to answer it first. The setter's
working notes are still never uploaded.

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

Models are answered **by hand**: you run a question wherever you like — a chat UI, an API
script, a colleague's laptop — and paste the answer into the question's Compare page. The app
makes no API calls and holds no keys.

Add the models you're benchmarking on the Models page.

| Field | What it is |
| --- | --- |
| **Display name** | The label in the results tables, e.g. `Gemini 2.5 Pro`. Yours to choose. |
| **Provider** | Which family it belongs to — used to group results. |
| **Model ID / version** | Which exact version answered, so results stay comparable later. |
| **Short name** | Internal identifier, defaults to the Model ID. |
| **Notes** | How you ran it — web UI, temperature, system prompt. |

### Recording an answer

**"Paste an answer by hand"** on any question's Compare page. Optionally paste the model's
reasoning too. Answers carry a **PASTED** badge, and are scored like anything else.

### Follow-up threads

Under any model answer, **Ask a follow-up** records a further exchange — the question you put
to the model and the reply it gave you. Useful for pushing on shaky reasoning ("what makes you
say the van is indicating?") without losing the thread. Follow-ups don't change the original
answer or its grade.

---

## Notes

- Data lives in `data/` — SQLite plus uploaded images. It's gitignored, so cloning this repo
  gives you the tool and none of the data. Back it up yourself if the answers matter.
- Every answer is stored, so re-recording one keeps the history; Compare shows the most recent
  per model.
- Schema changes migrate on startup, so after pulling an update **restart the dev server** — hot
  reload keeps the old database connection and you'll see "no such column" until you do.
- Free Supabase projects pause after about a week of inactivity; sync fails until someone
  unpauses the project from the dashboard.

## Licence

MIT — see [LICENSE](LICENSE).
