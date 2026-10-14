/**
 * Local development only: four sample annotators sharing one password, and a
 * sprint in its writing stage with a topic each (one V, two C, one I subtype),
 * so every checking flow can be tried by hand.
 *
 *   DEV_SEED_PASSWORD=something-long npm run db:seed-dev
 *
 * With --ready-to-check, the sprint ("Grounding test") comes with every topic's
 * questions already written, on generated test images, so the admin can go
 * straight to drawing checkers and starting verification. An empty live sprint
 * is closed to make room; one with questions is left alone.
 *
 *   npm run db:seed-dev -- --ready-to-check
 *
 * Refuses to run on Vercel or against anything but a localhost database.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import sharp from "sharp";
import { hashPassword } from "../src/server/password";

if (fs.existsSync(".env.local") && !process.env.VERCEL) process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL ?? "";
if (process.env.VERCEL || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("seed-dev only runs against a local database.");
  process.exit(1);
}
const password = process.env.DEV_SEED_PASSWORD ?? "";
if (password.length < 10) {
  console.error("Set DEV_SEED_PASSWORD (10+ characters) for the sample annotators.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const people = [
  ["fuad", "A H M Fuad", "1.1"],
  ["muttakin", "Muttakin Morshed", "1.4"],
  ["azmain", "Kazi Azmain Awsaf", "5.4"],
  ["rafi", "Sample Annotator", "8.1"],
] as const;

const readyToCheck = process.argv.includes("--ready-to-check");

// Questions for --ready-to-check: [question, options, index of the correct one], per subtype.
const QUESTIONS: Record<string, [string, string[], number][]> = {
  "1.1": [
    ["Is there a CNG auto-rickshaw in the scene?", ["Yes", "No"], 0],
    ["Is there a traffic police officer at the junction?", ["Yes", "No"], 1],
    ["Is there a bus stopped at the curb?", ["Yes", "No"], 0],
    ["Is there a bicycle in the scene?", ["Yes", "No"], 1],
  ],
  "1.4": [
    ["Are the brake lights of the bus in front on?", ["Yes", "No", "They can't be seen"], 0],
    ["Which indicator is the truck showing?", ["Left", "Right", "Hazard (both)", "None"], 0],
    ["Are the headlights of the oncoming car on?", ["Yes", "No"], 1],
    ["Is the rickshaw's hood raised?", ["Yes", "No"], 0],
  ],
  "5.4": [
    ["Is the pedestrian at the median about to cross?", ["Yes", "No"], 0],
    ["Which way is the CNG about to move?", ["Merge left", "Merge right", "Keep straight"], 0],
    ["Will the bus pull into the stop?", ["Yes", "No"], 0],
    ["Is the motorbike about to overtake the rickshaw?", ["Yes", "No"], 1],
  ],
  "8.1": [
    ["Why is the left lane blocked?", ["A parked bus", "Roadworks", "A broken-down truck", "Street vendors"], 0],
    ["Why are the pedestrians walking on the road?", ["Vendors occupy the footpath", "The footpath is under repair", "There is no footpath"], 0],
    ["Why has traffic stopped at the junction?", ["Red signal", "Police hand signal", "A crash ahead", "Congestion"], 1],
    ["Why is the rickshaw going the wrong way?", ["A shortcut to a side street", "No U-turn nearby", "Avoiding a jam"], 1],
  ],
};
const COLOURS = ["#3b6e8f", "#8f5a3b", "#4f7a43", "#6b4f8f"];

/** A plain labelled placeholder scene, saved where local development serves images from. */
async function testImage(userId: string, label: string, colour: string): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <rect width="1280" height="720" fill="${colour}"/>
    <rect y="430" width="1280" height="290" fill="#555"/>
    <rect x="0" y="565" width="1280" height="10" fill="#ddd" stroke-dasharray="60 40"/>
    <rect x="180" y="330" width="320" height="150" rx="16" fill="#1f9d55"/>
    <rect x="720" y="380" width="170" height="100" rx="12" fill="#f2c94c"/>
    <text x="640" y="150" font-family="sans-serif" font-size="64" font-weight="bold" fill="#fff" text-anchor="middle">TEST SCENE</text>
    <text x="640" y="230" font-family="sans-serif" font-size="40" fill="#fff" text-anchor="middle">${label}</text>
  </svg>`;
  const data = await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
  const dir = path.join(process.cwd(), ".uploads");
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.webp`;
  fs.writeFileSync(path.join(dir, name), data);
  const [row] = await sql<{ id: string }[]>`
    insert into images (uploader_id, storage, storage_key, format, width, height, bytes)
    values (${userId}, 'local', ${name}, 'webp', 1280, 720, ${data.length}) returning id`;
  // Every required tag group gets a tag, so the questions are complete.
  await sql`insert into image_tags (image_id, tag_id)
            select ${row.id}, (select t.id from tags t where t.group_id = g.id and t.active order by t.sort limit 1)
            from tag_groups g where g.active and (g.required or g.name = 'Weather & visibility')`;
  return row.id;
}

async function main() {
  const hash = await hashPassword(password);
  const [live] = await sql<{ id: number; name: string; questions: number }[]>`
    select s.id, s.name, (select count(*)::int from questions q where q.sprint_id = s.id) as questions
    from sprints s where status in ('writing', 'verifying')`;
  if (live && !(readyToCheck && live.questions === 0)) {
    throw new Error(`Sprint "${live.name}" is already live; close it first or reset .pgdata.`);
  }
  if (live) {
    await sql`update sprints set status = 'closed', closed_at = now() where id = ${live.id}`;
    console.log(`Closed the empty sprint "${live.name}" to make room.`);
  }
  const [sprint] = await sql<{ id: number }[]>`
    insert into sprints (name, status, writing_started_at)
    values (${readyToCheck ? "Grounding test" : "Dev sprint"}, 'writing', now()) returning id`;
  let written = 0;
  for (const [i, [username, name, code]] of people.entries()) {
    const [user] = await sql<{ id: string }[]>`
      insert into users (username, display_name, role, password_hash) values (${username}, ${name}, 'annotator', ${hash})
      on conflict (username) do update set password_hash = excluded.password_hash, active = true
      returning id`;
    const questions = readyToCheck ? QUESTIONS[code] : [];
    const [assignment] = await sql<{ id: number; subtype_id: number; verifiability: string }[]>`
      insert into assignments (sprint_id, annotator_id, category_id, subtype_id, target)
      select ${sprint.id}, ${user.id}, category_id, id, ${questions.length || 3} from subtypes where code = ${code}
      returning id, subtype_id, (select verifiability from subtypes where code = ${code})`;
    for (const [n, [prompt, texts, correct]] of questions.entries()) {
      const imageId = await testImage(user.id, `${username} · ${code} · ${n + 1}`, COLOURS[(i + n) % COLOURS.length]);
      const options = texts.map((text, k) => ({ id: "abcde"[k], text }));
      await sql`insert into questions (sprint_id, assignment_id, author_id, image_id, subtype_id, verifiability, prompt, options, correct_option)
                values (${sprint.id}, ${assignment.id}, ${user.id}, ${imageId}, ${assignment.subtype_id}, ${assignment.verifiability},
                        ${prompt}, ${sql.json(options)}, ${options[correct].id})`;
      written++;
    }
  }
  console.log(
    `Seeded sprint ${sprint.id} with ${people.map((p) => p[0]).join(", ")}` +
      (readyToCheck ? `: ${written} questions written, every target met. Draw checkers and start verification from the sprint page.` : "."),
  );
}

main()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error(error.message);
    await sql.end();
    process.exit(1);
  });
