// Lists the model IDs your API keys can actually see, so you can paste an exact
// string into the Model ID field instead of guessing. Run: npm run models
const GOOGLE = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
const { ANTHROPIC_API_KEY, OPENAI_API_KEY } = process.env;

function show(provider, ids) {
  console.log(`\n${provider} — ${ids.length} model${ids.length === 1 ? "" : "s"}`);
  for (const id of ids) console.log(`  ${id}`);
}

async function google() {
  if (!GOOGLE) return console.log("\nGoogle — no GOOGLE_API_KEY set, skipping");
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE}&pageSize=200`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google ${response.status}: ${await response.text()}`);
  const body = await response.json();
  const ids = (body.models ?? [])
    // Only models we can actually send an image + prompt to.
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .sort();
  show("Google", ids);
}

async function anthropic() {
  if (!ANTHROPIC_API_KEY) return console.log("\nAnthropic — no ANTHROPIC_API_KEY set, skipping");
  const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
  });
  if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`);
  const body = await response.json();
  show("Anthropic", (body.data ?? []).map((m) => m.id));
}

async function openai() {
  if (!OPENAI_API_KEY) return console.log("\nOpenAI — no OPENAI_API_KEY set, skipping");
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const body = await response.json();
  const ids = (body.data ?? []).map((m) => m.id).filter((id) => /^(gpt|o\d)/.test(id)).sort();
  show("OpenAI", ids);
}

for (const fn of [google, anthropic, openai]) {
  try {
    await fn();
  } catch (error) {
    console.error(`\n${error.message}`);
  }
}

console.log("\nPaste one of these into the Model ID field on the Models page.");
console.log("Note: the model must support image input for this benchmark.\n");
