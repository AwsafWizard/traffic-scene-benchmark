import "server-only";
import { audit } from "./audit";
import { sql } from "./db";
import { drawCheckers, type DrawTopic } from "./draw";
import { shuffled, type Verifiability } from "./engine";
import { topicSubtypeIds } from "./taxonomy";

/**
 * A sprint goes setup → writing → verifying → closed.
 *
 *   setup      the admin assigns topics and targets; annotators see nothing yet
 *   writing    annotators write questions on their topics
 *   verifying  writing is locked; every question is with its checkers
 *   closed     finished; read-only
 *
 * Only one sprint can be writing or verifying at a time.
 */

export type SprintStatus = "setup" | "writing" | "verifying" | "closed";

export interface Sprint {
  id: number;
  name: string;
  status: SprintStatus;
  model_sample_pct: number;
  created_at: Date;
  writing_started_at: Date | null;
  verification_started_at: Date | null;
  closed_at: Date | null;
}

export interface Assignment {
  id: number;
  sprint_id: number;
  annotator_id: string;
  annotator_name: string;
  category_id: number;
  category_code: string;
  category_name: string;
  subtype_id: number | null;
  subtype_code: string | null;
  subtype_name: string | null;
  target: number;
  /** Questions written, not counting dropped ones. */
  written: number;
  accepted: number;
  flagged: number;
  checking: number;
  checkers: { slot: number; id: string; name: string }[];
}

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

export async function liveSprint(): Promise<Sprint | null> {
  const [row] = await sql<Sprint[]>`select * from sprints where status in ('writing', 'verifying')`;
  return row ?? null;
}

export async function listSprints(): Promise<(Sprint & { questions: number; assignments: number })[]> {
  return sql`
    select s.*,
      (select count(*)::int from questions q where q.sprint_id = s.id and q.status <> 'dropped') as questions,
      (select count(*)::int from assignments a where a.sprint_id = s.id) as assignments
    from sprints s order by s.id desc`;
}

export async function getSprint(id: number): Promise<Sprint | null> {
  const [row] = await sql<Sprint[]>`select * from sprints where id = ${id}`;
  return row ?? null;
}

export async function sprintAssignments(sprintId: number, annotatorId?: string): Promise<Assignment[]> {
  const rows = await sql<Omit<Assignment, "checkers">[]>`
    select a.id, a.sprint_id, a.annotator_id, u.display_name as annotator_name,
      a.category_id, c.code as category_code, c.name as category_name,
      a.subtype_id, st.code as subtype_code, st.name as subtype_name, a.target,
      count(q.id) filter (where q.status <> 'dropped')::int as written,
      count(q.id) filter (where q.status = 'accepted')::int as accepted,
      count(q.id) filter (where q.status = 'flagged')::int as flagged,
      count(q.id) filter (where q.status = 'checking')::int as checking
    from assignments a
    join users u on u.id = a.annotator_id
    join categories c on c.id = a.category_id
    left join subtypes st on st.id = a.subtype_id
    left join questions q on q.assignment_id = a.id
    where a.sprint_id = ${sprintId} and ${annotatorId ? sql`a.annotator_id = ${annotatorId}` : sql`true`}
    group by a.id, u.display_name, c.code, c.name, c.sort, st.code, st.name, st.sort
    order by c.sort, c.code, st.sort nulls first, u.display_name`;
  const slots = await sql<{ assignment_id: number; slot: number; id: string; name: string }[]>`
    select cs.assignment_id, cs.slot, u.id, u.display_name as name
    from checker_slots cs join users u on u.id = cs.checker_id
    join assignments a on a.id = cs.assignment_id
    where a.sprint_id = ${sprintId} order by cs.slot`;
  return rows.map((r) => ({
    ...r,
    checkers: slots.filter((s) => s.assignment_id === r.id).map(({ slot, id, name }) => ({ slot, id, name })),
  }));
}

export async function createSprint(adminId: string, name: string, samplePct: number): Promise<Result & { id?: number }> {
  if (!name.trim()) return fail("Give the sprint a name.");
  if (!(samplePct >= 1 && samplePct <= 100)) return fail("The model-check sample is 1–100%.");
  const [row] = await sql<{ id: number }[]>`
    insert into sprints (name, model_sample_pct) values (${name.trim()}, ${Math.round(samplePct)}) returning id`;
  await audit(adminId, "sprint.create", row.id, { name });
  return { ok: true, id: row.id };
}

export async function updateSprint(adminId: string, id: number, name: string, samplePct: number): Promise<Result> {
  if (!name.trim()) return fail("Give the sprint a name.");
  if (!(samplePct >= 1 && samplePct <= 100)) return fail("The model-check sample is 1–100%.");
  await sql`update sprints set name = ${name.trim()}, model_sample_pct = ${Math.round(samplePct)} where id = ${id}`;
  await audit(adminId, "sprint.update", id, { name, samplePct });
  return { ok: true };
}

export async function addAssignment(
  adminId: string,
  sprintId: number,
  input: { annotatorId: string; categoryId: number; subtypeId: number | null; target: number },
): Promise<Result> {
  const sprint = await getSprint(sprintId);
  if (!sprint || !["setup", "writing"].includes(sprint.status)) {
    return fail("Topics can only be assigned while the sprint is being set up or written.");
  }
  if (!Number.isInteger(input.target) || input.target < 1 || input.target > 10000) return fail("Target is a whole number from 1.");
  const [annotator] = await sql`select 1 from users where id = ${input.annotatorId} and role = 'annotator' and active`;
  if (!annotator) return fail("Pick an active annotator.");
  const [category] = await sql`select 1 from categories where id = ${input.categoryId}`;
  if (!category) return fail("Pick a type.");
  if (input.subtypeId) {
    const [subtype] = await sql`select 1 from subtypes where id = ${input.subtypeId} and category_id = ${input.categoryId}`;
    if (!subtype) return fail("That subtype isn't in the chosen type.");
  }
  const [dupe] = await sql`
    select 1 from assignments where sprint_id = ${sprintId} and annotator_id = ${input.annotatorId}
      and category_id = ${input.categoryId} and subtype_id is not distinct from ${input.subtypeId}`;
  if (dupe) return fail("That annotator already has this topic.");

  const [row] = await sql<{ id: number }[]>`
    insert into assignments (sprint_id, annotator_id, category_id, subtype_id, target)
    values (${sprintId}, ${input.annotatorId}, ${input.categoryId}, ${input.subtypeId}, ${input.target})
    returning id`;
  await audit(adminId, "assignment.add", row.id, { sprintId, ...input });
  return { ok: true };
}

export async function updateAssignmentTarget(adminId: string, assignmentId: number, target: number): Promise<Result> {
  if (!Number.isInteger(target) || target < 1 || target > 10000) return fail("Target is a whole number from 1.");
  await sql`update assignments set target = ${target} where id = ${assignmentId}`;
  await audit(adminId, "assignment.target", assignmentId, { target });
  return { ok: true };
}

export async function removeAssignment(adminId: string, assignmentId: number): Promise<Result> {
  const [used] = await sql`select 1 from questions where assignment_id = ${assignmentId}`;
  if (used) return fail("Questions have been written on this topic, so it can't be removed.");
  await sql`delete from assignments where id = ${assignmentId}`;
  await audit(adminId, "assignment.remove", assignmentId);
  return { ok: true };
}

export async function startWriting(adminId: string, sprintId: number): Promise<Result> {
  const sprint = await getSprint(sprintId);
  if (sprint?.status !== "setup") return fail("Only a sprint being set up can start writing.");
  if (await liveSprint()) return fail("Another sprint is still live. Close it first.");
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from assignments where sprint_id = ${sprintId}`;
  if (n === 0) return fail("Assign at least one topic first.");
  await sql`update sprints set status = 'writing', writing_started_at = now() where id = ${sprintId}`;
  await audit(adminId, "sprint.start_writing", sprintId);
  return { ok: true };
}

interface TopicFacts {
  assignment_id: number;
  annotator_id: string;
  category_id: number;
  subtype_id: number | null;
  v: number;
  ci: number;
}

async function sprintTopics(sprintId: number): Promise<{ facts: TopicFacts[]; topics: DrawTopic[] }> {
  const facts = await sql<TopicFacts[]>`
    select a.id as assignment_id, a.annotator_id, a.category_id, a.subtype_id,
      count(q.id) filter (where q.status = 'written' and q.verifiability = 'V')::int as v,
      count(q.id) filter (where q.status = 'written' and q.verifiability <> 'V')::int as ci
    from assignments a left join questions q on q.assignment_id = a.id
    where a.sprint_id = ${sprintId} group by a.id`;
  const topics: DrawTopic[] = [];
  for (const f of facts) {
    topics.push({
      assignmentId: f.assignment_id,
      authorId: f.annotator_id,
      subtypeIds: await topicSubtypeIds(f.category_id, f.subtype_id),
      loadPerChecker: f.ci + Math.ceil(f.v / 2),
    });
  }
  return { facts, topics };
}

/** Draws two checkers for every topic that has questions, replacing any earlier draw. */
export async function drawSprintCheckers(adminId: string, sprintId: number): Promise<Result> {
  const sprint = await getSprint(sprintId);
  if (sprint?.status !== "writing") return fail("Checkers are drawn while the sprint is in its writing stage.");
  const { facts, topics } = await sprintTopics(sprintId);
  const annotators = (await sql<{ id: string }[]>`select id from users where role = 'annotator' and active`).map((r) => r.id);
  const result = drawCheckers(topics, annotators);
  if (!result.ok) {
    const f = facts.find((t) => t.assignment_id === result.assignmentId);
    const [who] = await sql<{ display_name: string }[]>`select display_name from users where id = ${f?.annotator_id ?? null}`;
    return fail(`${who?.display_name ?? "A"}'s topic: ${result.error}`);
  }
  const withQuestions = new Set(facts.filter((f) => f.v + f.ci > 0).map((f) => f.assignment_id));
  const rows = result.slots
    .filter((s) => withQuestions.has(s.assignmentId))
    .flatMap((s) => s.checkerIds.map((checker_id, i) => ({ assignment_id: s.assignmentId, slot: i + 1, checker_id })));

  await sql.begin(async (tx) => {
    await tx`delete from checker_slots where assignment_id in (select id from assignments where sprint_id = ${sprintId})`;
    if (rows.length) {
      await tx`insert into checker_slots (assignment_id, slot, checker_id)
               select assignment_id, slot, checker_id
               from jsonb_to_recordset(${tx.json(rows)}) as r(assignment_id int, slot int, checker_id uuid)`;
    }
    await audit(adminId, "sprint.draw_checkers", sprintId, { topics: rows.length / 2 }, tx);
  });
  return { ok: true };
}

/** The admin swapping a drawn checker by hand. The same eligibility rule applies. */
export async function setCheckerSlot(adminId: string, assignmentId: number, slot: number, checkerId: string): Promise<Result> {
  const [a] = await sql<{ sprint_id: number; status: SprintStatus }[]>`
    select a.sprint_id, s.status from assignments a join sprints s on s.id = a.sprint_id where a.id = ${assignmentId}`;
  if (!a || a.status !== "writing") return fail("Checkers can only be changed before verification starts.");
  if (slot !== 1 && slot !== 2) return fail("Bad slot.");
  const { facts, topics } = await sprintTopics(a.sprint_id);
  const topic = topics.find((t) => t.assignmentId === assignmentId)!;
  const conflicts = facts.filter(
    (f) => f.annotator_id === checkerId && topics.find((t) => t.assignmentId === f.assignment_id)!.subtypeIds.some((s) => topic.subtypeIds.includes(s)),
  );
  if (conflicts.length) return fail("That person writes in this topic (or one that overlaps it), so they can't check it.");
  const [other] = await sql`select 1 from checker_slots where assignment_id = ${assignmentId} and slot <> ${slot} and checker_id = ${checkerId}`;
  if (other) return fail("That person is already this topic's other checker.");
  await sql`insert into checker_slots (assignment_id, slot, checker_id) values (${assignmentId}, ${slot}, ${checkerId})
            on conflict (assignment_id, slot) do update set checker_id = excluded.checker_id`;
  await audit(adminId, "assignment.set_checker", assignmentId, { slot, checkerId });
  return { ok: true };
}

/**
 * Locks writing and hands every written question to its checkers: one check for
 * V questions (alternating between the topic's two checkers), two for C and I.
 * Each check gets its own shuffled option order.
 */
export async function startVerification(adminId: string, sprintId: number): Promise<Result> {
  return sql.begin(async (tx) => {
    const [sprint] = await tx<Sprint[]>`select * from sprints where id = ${sprintId} for update`;
    if (sprint?.status !== "writing") return fail("Only a sprint in its writing stage can start verification.");

    const questions = await tx<{ id: string; assignment_id: number; verifiability: Verifiability; options: { id: string }[] }[]>`
      select id, assignment_id, verifiability, options from questions
      where sprint_id = ${sprintId} and status = 'written' order by assignment_id, created_at, id`;
    if (questions.length === 0) return fail("No questions have been written yet.");

    const slots = await tx<{ assignment_id: number; slot: number; checker_id: string }[]>`
      select cs.assignment_id, cs.slot, cs.checker_id from checker_slots cs
      join assignments a on a.id = cs.assignment_id where a.sprint_id = ${sprintId}`;
    const byTopic = new Map<number, string[]>();
    for (const s of slots.sort((x, y) => x.slot - y.slot)) {
      byTopic.set(s.assignment_id, [...(byTopic.get(s.assignment_id) ?? []), s.checker_id]);
    }

    const rows: { question_id: string; checker_id: string; role: string | null; option_order: string[] }[] = [];
    const vTurn = new Map<number, number>();
    for (const q of questions) {
      const checkers = byTopic.get(q.assignment_id);
      if (!checkers || checkers.length < 2) return fail("Every topic with questions needs two checkers. Draw them first.");
      const order = () => shuffled(q.options.map((o) => o.id));
      if (q.verifiability === "V") {
        const turn = vTurn.get(q.assignment_id) ?? 0;
        vTurn.set(q.assignment_id, turn + 1);
        rows.push({ question_id: q.id, checker_id: checkers[turn % 2], role: "v", option_order: order() });
      } else {
        const role = q.verifiability === "C" ? "c" : null;
        for (const checker of checkers) rows.push({ question_id: q.id, checker_id: checker, role, option_order: order() });
      }
    }

    await tx`insert into checks (question_id, checker_id, role, option_order)
             select question_id, checker_id, role, option_order
             from jsonb_to_recordset(${tx.json(rows)}) as r(question_id uuid, checker_id uuid, role text, option_order jsonb)`;
    await tx`update questions set status = 'checking', updated_at = now() where sprint_id = ${sprintId} and status = 'written'`;
    await tx`update sprints set status = 'verifying', verification_started_at = now() where id = ${sprintId}`;
    await audit(adminId, "sprint.start_verification", sprintId, { questions: questions.length, checks: rows.length }, tx);
    return { ok: true } as Result;
  });
}

export async function closeSprint(adminId: string, sprintId: number): Promise<Result> {
  const sprint = await getSprint(sprintId);
  if (sprint?.status !== "verifying") return fail("Only a sprint in verification can be closed.");
  await sql`update sprints set status = 'closed', closed_at = now() where id = ${sprintId}`;
  await audit(adminId, "sprint.close", sprintId);
  return { ok: true };
}

/**
 * Picks the model-check sample: the sprint's percentage of questions, drawn at
 * random within every subtype (at least one per subtype), so each is covered.
 * Kept in the database, so the same sample is used every time.
 */
export async function drawModelSample(adminId: string, sprintId: number): Promise<Result & { size?: number }> {
  const sprint = await getSprint(sprintId);
  if (!sprint || sprint.status === "setup" || sprint.status === "writing") {
    return fail("Draw the sample once writing has finished.");
  }
  const [answered] = await sql`
    select 1 from model_answers ma join model_samples ms on ms.question_id = ma.question_id
    where ms.sprint_id = ${sprintId}`;
  if (answered) return fail("Model answers are already recorded against this sample, so it can't be redrawn.");

  const questions = await sql<{ id: string; subtype_id: number }[]>`
    select id, subtype_id from questions where sprint_id = ${sprintId} and status <> 'dropped'`;
  const bySubtype = new Map<number, string[]>();
  for (const q of questions) bySubtype.set(q.subtype_id, [...(bySubtype.get(q.subtype_id) ?? []), q.id]);
  const picked: string[] = [];
  for (const ids of bySubtype.values()) {
    const take = Math.max(1, Math.ceil((ids.length * sprint.model_sample_pct) / 100));
    picked.push(...shuffled(ids).slice(0, take));
  }

  await sql.begin(async (tx) => {
    await tx`delete from model_samples where sprint_id = ${sprintId}`;
    if (picked.length) {
      await tx`insert into model_samples (sprint_id, question_id)
               select ${sprintId}, unnest(${picked}::uuid[])`;
    }
    await audit(adminId, "sprint.draw_sample", sprintId, { size: picked.length }, tx);
  });
  return { ok: true, size: picked.length };
}
