# Traffic Scene Benchmark

Benchmarks LLMs on spatial, logical, and behavioral questions about traffic and road
scenes — measured against a human baseline rather than against a score in isolation.

The loop is: **set a question → a human answers it blind → the models answer it → compare.**
Because the human answers before seeing anything else, you learn two things at once: how the
models perform, and whether the question was any good.

Everything runs locally: Next.js and SQLite, with your images and answers stored on disk in
`data/`. Nothing is uploaded anywhere except the model API calls you explicitly trigger.

## Setup

Requires **Node 20+**.

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

<details>
<summary>If your system Node is older than 20</summary>

`./dev.sh dev` sources nvm, selects Node 20, and puts it first on `PATH` before starting the
dev server — Turbopack spawns child `node` processes, so it isn't enough to launch a newer
binary directly. If you have ever started the app under an older Node, delete `.next/` first;
the stale chunks keep failing otherwise.

</details>

### API keys

Keys go in `.env.local` at the project root — never into the app's UI. Fill in only the
providers you want to test, then restart the dev server. The Models page shows which keys it
can see.

```
GOOGLE_API_KEY=your-key-here
```

`GEMINI_API_KEY` is accepted as an alias for `GOOGLE_API_KEY`.

### Finding model IDs

Model IDs change often, so ask your own account rather than guessing:

```bash
npm run models
```

This prints the exact model strings each of your keys can see. Paste one into the **Model ID**
field on the Models page. The model must support image input.

## Comments

Both sides can leave notes on a question. The grounder can flag that an image is too small or
the wording is ambiguous; the setter keeps working notes on whether a question earns its place.

The grounder only ever sees their **own** comments — a setter's note could give away the
intended answer and defeat the point of answering blind. Grounder comments travel back inside
the answer bundle and show up on the Compare page with a "grounder flagged this" marker.

## The workflow

1. **Add question** — upload a scene, write the question, tag it spatial / logical /
   behavioral, and choose multiple-choice or free-text. A reference answer is optional for
   free text; for multiple choice it enables automatic scoring.
2. **Ground** — the grounder sees only the image and the question. Never the reference
   answer, never the model answers. They give an answer, a confidence rating, and optionally
   their reasoning.
3. **Compare** — after submitting, everything is revealed. Run the models from here and grade
   each answer correct / partial / incorrect. Multiple-choice answers are graded
   automatically; free-text ones you grade yourself.
4. **Results** — accuracy per model, broken out by category, with the human row alongside.

## Reading the question-quality table

The second table on Results is about your questions, not the models:

| Flag | Meaning |
| --- | --- |
| **discriminative** | Humans got it right, models got it wrong. This is the question you want more of. |
| **too easy** | Every model got it right — no signal. |
| **ambiguous** | Multiple grounders gave different answers. Usually the question needs rewriting, not the model. |
| **hard for humans** | Humans got it wrong, so the reference answer or the image may be the problem. |

The `gap` column is human accuracy minus model accuracy — the higher it is, the more that
question is actually measuring something.

## Adding models

Any number, from any of the three providers, on the Models page. You supply the exact API
model string; nothing is hardcoded.

| Field | What it is |
| --- | --- |
| **Display name** | The label in the results tables, e.g. `Gemini 2.5 Pro`. Yours to choose. |
| **Provider** | Which API to call. |
| **Model ID** | The exact API model string, from `npm run models`. |
| **Short name** | Internal identifier, defaults to the Model ID. **Not an API key.** |
| **Extra request params** | JSON merged into the API call — pin `temperature` here so runs stay comparable. |

Only enabled models run. Disabling a model keeps its past results in the tables.


## Working with a partner

There are two ways to get someone else answering questions.

**Same network** — the Share page gives them a link that puts their browser into
grounding mode. Nothing to install; your machine has to stay awake.

**Their own copy** — the Transfer page moves work between two installs as a single
`.json` file. Images travel inside the file, so there's nothing else to send.

1. You export the questions and send them the file.
2. They import it into their copy and answer everything.
3. They export their answers and send that file back.
4. You import it — answers are matched by a stable question id and scored automatically.

The question bundle deliberately omits reference answers, notes, and model responses, so
handing it over can't spoil the grounding. Answer bundles carry no images, so they stay small.
Re-importing the same file is a no-op, so it's safe to do twice.

## Follow-up threads

Under any model answer, **Ask a follow-up** starts a conversation with that model about its
own answer — the image and the full thread go back with each turn, so you can push on shaky
reasoning ("what makes you say the van is indicating?").

Follow-ups reply in prose rather than the scored JSON format, and they don't change the
original answer or its grade. For manual models you paste the reply in alongside the question.

## Notes

- Data lives in `data/` — SQLite plus the uploaded images. It is gitignored, so cloning this
  repo gives you the tool and none of the data. Back `data/` up yourself if the answers matter.
- API keys live in `.env.local` (also gitignored) and are only ever read server-side.
- Model calls run in parallel, and a failure is recorded per model rather than failing the
  whole run, so one bad API key doesn't lose the others' answers.
- Each run is stored, so re-running a question keeps the history; the Compare page shows the
  most recent answer per model.

## Licence

MIT — see [LICENSE](LICENSE).
