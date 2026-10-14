/**
 * End-to-end sprint workflow against a real Postgres: accounts, writing,
 * the checker draw, all three checking flows, blindness, concurrency, review,
 * statistics and export. Runs against a throwaway database next to the dev one
 * (start it with `npm run db:dev`); skipped when no database is reachable.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/postgres";
const TEST_DB = "dhakavqa_test";
const TEST_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);

async function databaseReachable(): Promise<boolean> {
  const probe = postgres(ADMIN_URL, { max: 1, connect_timeout: 2, onnotice: () => {} });
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("sprint workflow", () => {
  // Loaded after DATABASE_URL points at the test database.
  let m: {
    sql: typeof import("../src/server/db").sql;
    users: typeof import("../src/server/users");
    sprints: typeof import("../src/server/sprints");
    questions: typeof import("../src/server/questions");
    checks: typeof import("../src/server/checks");
    stats: typeof import("../src/server/stats");
    exporter: typeof import("../src/server/export");
    taxonomy: typeof import("../src/server/taxonomy");
    models: typeof import("../src/server/models");
  };
  const ids: Record<string, string> = {};
  let sprintId = 0;
  const subtype: Record<string, number> = {};
  const question: Record<string, string> = {};

  beforeAll(async () => {
    const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    await admin.unsafe(`drop database if exists ${TEST_DB} with (force)`);
    await admin.unsafe(`create database ${TEST_DB}`);
    await admin.end();

    const setup = postgres(TEST_URL, { max: 1, onnotice: () => {} });
    const dir = path.join(__dirname, "..", "db", "migrations");
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await setup.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
    }
    await setup.end();

    process.env.DATABASE_URL = TEST_URL;
    m = {
      sql: (await import("../src/server/db")).sql,
      users: await import("../src/server/users"),
      sprints: await import("../src/server/sprints"),
      questions: await import("../src/server/questions"),
      checks: await import("../src/server/checks"),
      stats: await import("../src/server/stats"),
      exporter: await import("../src/server/export"),
      taxonomy: await import("../src/server/taxonomy"),
      models: await import("../src/server/models"),
    };
    for (const row of await m.sql<{ id: number; code: string }[]>`select id, code from subtypes`) subtype[row.code] = row.id;
  });

  afterAll(async () => {
    await m?.sql.end();
  });

  it("creates the admin and four annotators with one-time passwords", async () => {
    const [admin] = await m.sql<{ id: string }[]>`
      insert into users (username, display_name, role, password_hash) values ('admin', 'Admin', 'admin', 'x') returning id`;
    ids.admin = admin.id;
    for (const name of ["ann", "bob", "cat", "dan"]) {
      const result = await m.users.createAnnotator(ids.admin, name, name.toUpperCase());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.password).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
        const [row] = await m.sql<{ id: string; password_hash: string }[]>`select id, password_hash from users where username = ${name}`;
        expect(row.password_hash).not.toContain(result.password);
        ids[name] = row.id;
      }
    }
    expect((await m.users.createAnnotator(ids.admin, "ANN", "Dup")).ok).toBe(false);
    await expect(
      m.sql`insert into users (username, display_name, role, password_hash) values ('admin2', 'A2', 'admin', 'x')`,
    ).rejects.toThrow();
  });

  it("sets up a sprint and starts writing", async () => {
    const created = await m.sprints.createSprint(ids.admin, "Pilot", 50);
    sprintId = created.id!;
    const topics = [
      ["ann", "1.1"],
      ["bob", "1.4"],
      ["cat", "5.4"],
      ["dan", "8.1"],
    ] as const;
    for (const [who, code] of topics) {
      const [st] = await m.sql<{ category_id: number }[]>`select category_id from subtypes where id = ${subtype[code]}`;
      const result = await m.sprints.addAssignment(ids.admin, sprintId, {
        annotatorId: ids[who],
        categoryId: st.category_id,
        subtypeId: subtype[code],
        target: 2,
      });
      expect(result).toEqual({ ok: true });
    }
    expect(await m.sprints.startWriting(ids.admin, sprintId)).toEqual({ ok: true });
    const second = await m.sprints.createSprint(ids.admin, "Second", 10);
    expect((await m.sprints.startWriting(ids.admin, second.id!)).ok).toBe(false);
  });

  it("lets annotators write only on their topics, with tagged images", async () => {
    const tags = await m.sql<{ id: number; group: string }[]>`
      select t.id, g.name as group from tags t join tag_groups g on g.id = t.group_id where g.required`;
    const required = [tags.find((t) => t.group === "View")!.id, tags.find((t) => t.group === "Time of day")!.id];

    for (const who of ["ann", "bob", "cat", "dan"]) {
      const [image] = await m.sql<{ id: string }[]>`
        insert into images (uploader_id, storage, storage_key, format) values (${ids[who]}, 'local', ${`${who}.png`}, 'png') returning id`;
      ids[`${who}_image`] = image.id;
      const { topics } = await m.questions.myTopics(ids[who]);
      expect(topics).toHaveLength(1);
      const topic = topics[0];
      const input = (n: number) => ({
        subtypeId: topic.subtypes[0].id,
        imageId: image.id,
        prompt: `${who} question ${n}`,
        options: ["Yes", "No", "Can't say"],
        correctIndex: 0,
      });

      const untagged = await m.questions.createQuestion(ids[who], topic.id, input(0));
      expect(untagged).toMatchObject({ ok: false, error: expect.stringContaining("Tag the image") });
      expect((await m.questions.setImageTags(ids[who], image.id, required)).ok).toBe(true);

      for (const n of [1, 2]) {
        const result = await m.questions.createQuestion(ids[who], topic.id, input(n));
        expect(result.ok).toBe(true);
        question[`${who}${n}`] = result.id!;
      }
    }

    // Codes: setter number, subtype, then the setter's count in that subtype.
    const codes = await m.sql<{ id: string; code: string }[]>`select id, code from questions`;
    const codeOf = (id: string) => codes.find((c) => c.id === id)?.code;
    expect(codeOf(question.ann1)).toBe("01-1.1-001");
    expect(codeOf(question.ann2)).toBe("01-1.1-002");
    expect(codeOf(question.dan2)).toBe("04-8.1-002");

    // Someone else's topic, a wrong subtype, someone else's image.
    const { topics: annTopics } = await m.questions.myTopics(ids.ann);
    expect((await m.questions.createQuestion(ids.bob, annTopics[0].id, {
      subtypeId: subtype["1.1"], imageId: ids.bob_image, prompt: "x", options: ["a", "b"], correctIndex: 0,
    })).ok).toBe(false);
    expect((await m.questions.createQuestion(ids.ann, annTopics[0].id, {
      subtypeId: subtype["1.2"], imageId: ids.ann_image, prompt: "x", options: ["a", "b"], correctIndex: 0,
    })).ok).toBe(false);
    expect((await m.questions.createQuestion(ids.ann, annTopics[0].id, {
      subtypeId: subtype["1.1"], imageId: ids.bob_image, prompt: "x", options: ["a", "b"], correctIndex: 0,
    })).ok).toBe(false);
    // Content rules.
    expect(m.questions.validateQuestionContent({ prompt: "q", options: ["a"], correctIndex: 0 }).ok).toBe(false);
    expect(m.questions.validateQuestionContent({ prompt: "q", options: ["a", "A"], correctIndex: 0 }).ok).toBe(false);
    expect(m.questions.validateQuestionContent({ prompt: "q", options: ["a", "b"], correctIndex: 2 }).ok).toBe(false);
  });

  it("draws two checkers per topic, never its writer, and hands out checks", async () => {
    expect(await m.sprints.drawSprintCheckers(ids.admin, sprintId)).toEqual({ ok: true });
    const assignments = await m.sprints.sprintAssignments(sprintId);
    for (const a of assignments) {
      expect(a.checkers).toHaveLength(2);
      expect(a.checkers.map((c) => c.id)).not.toContain(a.annotator_id);
    }
    // A swap that breaks the rule is refused.
    const annTopic = assignments.find((a) => a.annotator_id === ids.ann)!;
    expect((await m.sprints.setCheckerSlot(ids.admin, annTopic.id, 1, ids.ann)).ok).toBe(false);

    expect(await m.sprints.startVerification(ids.admin, sprintId)).toEqual({ ok: true });
    const counts = await m.sql<{ verifiability: string; n: number }[]>`
      select q.verifiability, count(c.id)::int as n from questions q join checks c on c.question_id = q.id
      group by q.verifiability`;
    const byV = Object.fromEntries(counts.map((c) => [c.verifiability, c.n]));
    expect(byV).toEqual({ V: 2, C: 8, I: 4 });
    // The two V questions went to different checkers.
    const vCheckers = await m.sql<{ checker_id: string }[]>`
      select c.checker_id from checks c join questions q on q.id = c.question_id where q.verifiability = 'V'`;
    expect(new Set(vCheckers.map((r) => r.checker_id)).size).toBe(2);
    // Writing is now locked.
    const { topics } = await m.questions.myTopics(ids.ann);
    expect((await m.questions.createQuestion(ids.ann, topics[0].id, {
      subtypeId: subtype["1.1"], imageId: ids.ann_image, prompt: "late", options: ["a", "b"], correctIndex: 0,
    })).ok).toBe(false);
  });

  async function checkFor(questionKey: string) {
    return m.sql<{ id: string; checker_id: string }[]>`
      select id, checker_id from checks where question_id = ${question[questionKey]} order by created_at, id`;
  }
  const status = async (key: string) =>
    (await m.sql<{ status: string; resolution: string | null }[]>`select status, resolution from questions where id = ${question[key]}`)[0];

  it("V: a match is accepted; a confirmed setter mistake is flagged", async () => {
    const [c1] = await checkFor("ann1");
    const blind = await m.checks.getTask(c1.checker_id, c1.id);
    expect(blind?.step).toBe("blind");
    expect(JSON.stringify(blind)).not.toContain('"setter"');
    expect(await m.checks.submitBlind(c1.checker_id, c1.id, "a", "")).toEqual({ ok: true });
    expect(await status("ann1")).toEqual({ status: "accepted", resolution: "agreed" });

    const [c2] = await checkFor("ann2");
    expect((await m.checks.submitBlind(c2.checker_id, c2.id, "none", "")).ok).toBe(false); // needs a note
    expect(await m.checks.submitBlind(c2.checker_id, c2.id, "none", "There are 7")).toEqual({ ok: true });
    const judging = await m.checks.getTask(c2.checker_id, c2.id);
    expect(judging?.step).toBe("judgment");
    if (judging?.step === "judgment") expect(judging.setter).toBe("a");
    expect((await m.checks.submitJudgment(c2.checker_id, c2.id, "agree", "", null)).ok).toBe(false); // wrong judgment for V
    expect((await m.checks.submitJudgment(c2.checker_id, c2.id, "setter_mistake", "", null)).ok).toBe(false); // reason required
    expect(await m.checks.submitJudgment(c2.checker_id, c2.id, "setter_mistake", "Counted wrong", null)).toEqual({ ok: true });
    expect(await status("ann2")).toEqual({ status: "flagged", resolution: "setter_mistake" });
  });

  it("C: stays blind; all three must agree", async () => {
    const [a, b] = await checkFor("bob1");
    expect(await m.checks.submitBlind(a.checker_id, a.id, "a", "")).toEqual({ ok: true });
    const done = await m.checks.getTask(a.checker_id, a.id);
    expect(done?.step).toBe("done");
    expect(JSON.stringify(done)).not.toContain('"setter"');
    expect((await status("bob1")).status).toBe("checking");
    expect(await m.checks.submitBlind(b.checker_id, b.id, "a", "")).toEqual({ ok: true });
    expect(await status("bob1")).toEqual({ status: "accepted", resolution: "agreed" });

    const [c, d] = await checkFor("bob2");
    await m.checks.submitBlind(c.checker_id, c.id, "a", "");
    await m.checks.submitBlind(d.checker_id, d.id, "b", "");
    expect(await status("bob2")).toEqual({ status: "flagged", resolution: "disagreed" });
  });

  it("refuses work from someone who isn't the checker, and double answers", async () => {
    const [a] = await checkFor("dan1");
    expect((await m.checks.submitBlind(ids.dan, a.id, "a", "")).ok).toBe(false);
    expect(await m.checks.getTask(ids.dan, a.id)).toBeNull();
    const [done] = await checkFor("bob1");
    expect((await m.checks.submitBlind(done.checker_id, done.id, "b", "")).ok).toBe(false);
  });

  it("I: whoever answers first is second; the third sees both; both must say yes", async () => {
    const [a, b] = await checkFor("cat1");
    // Both answer at the same moment: exactly one becomes second.
    const results = await Promise.all([
      m.checks.submitBlind(a.checker_id, a.id, "b", ""),
      m.checks.submitBlind(b.checker_id, b.id, "a", ""),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    const roles = await m.sql<{ id: string; role: string }[]>`select id, role from checks where question_id = ${question.cat1}`;
    expect(roles.map((r) => r.role).sort()).toEqual(["second", "third"]);
    const second = roles.find((r) => r.role === "second")!;
    const third = roles.find((r) => r.role === "third")!;
    const secondChecker = second.id === a.id ? a.checker_id : b.checker_id;
    const thirdChecker = third.id === a.id ? a.checker_id : b.checker_id;

    const secondView = await m.checks.getTask(secondChecker, second.id);
    expect(secondView?.step).toBe("judgment");
    if (secondView?.step === "judgment") expect(secondView.second).toBeUndefined();
    const thirdView = await m.checks.getTask(thirdChecker, third.id);
    if (thirdView?.step === "judgment") expect(thirdView.second).toBeDefined();
    else throw new Error("third should be at the judgment step");

    expect(await m.checks.submitJudgment(secondChecker, second.id, "agree", "", null)).toEqual({ ok: true });
    expect((await status("cat1")).status).toBe("checking");
    expect((await m.checks.submitJudgment(thirdChecker, third.id, "not_all_agree", "Too sure", null)).ok).toBe(false); // odd one needed
    expect(await m.checks.submitJudgment(thirdChecker, third.id, "all_agree", "", null)).toEqual({ ok: true });
    expect(await status("cat1")).toEqual({ status: "accepted", resolution: "agreed" });

    const [c, d] = await checkFor("cat2");
    await m.checks.submitBlind(c.checker_id, c.id, "a", "");
    await m.checks.submitJudgment(c.checker_id, c.id, "disagree", "It's ambiguous", null);
    await m.checks.submitBlind(d.checker_id, d.id, "a", "");
    await m.checks.submitJudgment(d.checker_id, d.id, "not_all_agree", "Second disagreed", "second");
    expect(await status("cat2")).toEqual({ status: "flagged", resolution: "second_disagreed" });
  });

  it("queues show what's left, second steps first", async () => {
    const [a] = await checkFor("dan1");
    const queue = await m.checks.myQueue(a.checker_id);
    expect(queue.todo.some((t) => t.check_id === a.id && t.step === "blind")).toBe(true);
  });

  it("lets the admin send back, the setter fix and resubmit, and the admin accept", async () => {
    expect((await m.questions.reviewQuestion(ids.admin, question.ann2, "send_back", {})).ok).toBe(false); // note required
    expect(await m.questions.reviewQuestion(ids.admin, question.ann2, "send_back", { note: "Recount" })).toEqual({ ok: true });
    const fixed = await m.questions.updateQuestion(ids.ann, question.ann2, {
      subtypeId: subtype["1.1"], imageId: ids.ann_image, prompt: "ann question 2 (fixed)", options: ["Yes", "No"], correctIndex: 1,
    });
    expect(fixed).toEqual({ ok: true });
    expect(await m.questions.resubmitQuestion(ids.ann, question.ann2)).toEqual({ ok: true });
    expect((await status("ann2")).status).toBe("flagged");
    expect(await m.questions.reviewQuestion(ids.admin, question.ann2, "accept", {})).toEqual({ ok: true });
    expect((await status("ann2")).status).toBe("accepted");
    // Fixing must keep the option count, so recorded answers still point at the same options.
    expect((await m.questions.reviewQuestion(ids.admin, question.bob2, "fix", { options: ["a", "b"] })).ok).toBe(false);
  });

  it("drops with a reason the setter can act on: fix, resubmit, back to review", async () => {
    expect((await m.questions.reviewQuestion(ids.admin, question.ann2, "drop", {})).ok).toBe(false); // reason required
    expect(await m.questions.reviewQuestion(ids.admin, question.ann2, "drop", { note: "Blurry image" })).toEqual({ ok: true });
    expect(await status("ann2")).toMatchObject({ status: "dropped" });
    // Only the setter can fix it.
    const input = { subtypeId: subtype["1.1"], imageId: ids.ann_image, prompt: "ann question 2 (sharper)", options: ["Yes", "No"], correctIndex: 1 };
    expect((await m.questions.updateQuestion(ids.bob, question.ann2, input)).ok).toBe(false);
    expect(await m.questions.updateQuestion(ids.ann, question.ann2, input)).toEqual({ ok: true });
    expect(await m.questions.resubmitQuestion(ids.ann, question.ann2)).toEqual({ ok: true });
    expect(await status("ann2")).toMatchObject({ status: "flagged" });
    expect(await m.questions.reviewQuestion(ids.admin, question.ann2, "accept", {})).toEqual({ ok: true });
  });

  it("lets the setter edit a flagged question, which the same checkers then answer afresh", async () => {
    const before = await checkFor("cat2");
    const input = { subtypeId: subtype["5.4"], imageId: ids.cat_image, prompt: "cat question 2 (clearer)", options: ["Yes", "No", "Not sure"], correctIndex: 0 };
    expect((await m.questions.updateQuestion(ids.ann, question.cat2, input)).ok).toBe(false); // not the setter
    expect(await m.questions.updateQuestion(ids.cat, question.cat2, input)).toEqual({ ok: true, rechecking: true });
    expect(await status("cat2")).toEqual({ status: "checking", resolution: null });

    const after = await m.sql<{ id: string; checker_id: string; role: string | null; blind_choice: string | null; option_order: string[] }[]>`
      select id, checker_id, role, blind_choice, option_order from checks where question_id = ${question.cat2}`;
    expect(after.map((c) => c.checker_id).sort()).toEqual(before.map((c) => c.checker_id).sort());
    expect(after.every((c) => c.role === null && c.blind_choice === null && c.option_order.length === 3)).toBe(true);
    // A page still open on the old version can't answer the new one.
    expect((await m.checks.submitBlind(before[0].checker_id, before[0].id, "a", "")).ok).toBe(false);
    const [history] = await m.sql<{ details: { old_checks: unknown[] } }[]>`
      select details from audit_log where action = 'question.edit_resubmit' and target = ${question.cat2}`;
    expect(history.details.old_checks).toHaveLength(2);

    const [c, d] = after;
    await m.checks.submitBlind(c.checker_id, c.id, "a", "");
    await m.checks.submitJudgment(c.checker_id, c.id, "disagree", "Still ambiguous", null);
    await m.checks.submitBlind(d.checker_id, d.id, "a", "");
    await m.checks.submitJudgment(d.checker_id, d.id, "not_all_agree", "Second disagreed", "second");
    expect(await status("cat2")).toEqual({ status: "flagged", resolution: "second_disagreed" });

    // Accepted questions are final.
    expect((await m.questions.updateQuestion(ids.cat, question.cat1, { ...input, prompt: "late change" })).ok).toBe(false);
  });

  it("reports statistics and agreement", async () => {
    const o = await m.stats.overview(sprintId);
    expect(o.status.total).toBe(8);
    expect(o.status.accepted).toBe(4);
    expect(o.status.flagged).toBe(2);
    expect(o.agreement.C.complete).toBe(2);
    expect(o.agreement.C.allAgree).toBe(1);
    expect(o.agreement.I.accepted).toBe(1);
    expect(o.agreement.V.setterMistake).toBe(1);
    const table = await m.stats.annotatorTable(sprintId);
    expect(table.find((r) => r.id === ids.ann)?.written).toBe(2);
    const detail = await m.stats.questionDetail(question.cat1);
    expect(detail?.checks).toHaveLength(2);
  });

  it("draws a model sample covering every subtype", async () => {
    const result = await m.sprints.drawModelSample(ids.admin, sprintId);
    expect(result.ok).toBe(true);
    const covered = await m.sql<{ n: number }[]>`
      select count(distinct q.subtype_id)::int as n from model_samples ms join questions q on q.id = ms.question_id
      where ms.sprint_id = ${sprintId}`;
    expect(covered[0].n).toBe(4);
  });

  it("exports JSON records and safe CSV", async () => {
    const records = await m.exporter.exportRecords({ sprintId, status: "accepted" });
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({ options: expect.any(Array), checks: expect.any(Array), tags: expect.any(Object) });
    const csv = m.exporter.toCsv([{ ...records[0], question: "=HYPERLINK(\"x\")" }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("closes the sprint and stops further checking", async () => {
    expect(await m.sprints.closeSprint(ids.admin, sprintId)).toEqual({ ok: true });
    const [a] = await checkFor("dan1");
    expect((await m.checks.submitBlind(a.checker_id, a.id, "a", "")).ok).toBe(false);
  });

  it("revoking ends the annotator's sessions", async () => {
    await m.sql`insert into sessions (id, user_id, expires_at) values ('t1', ${ids.dan}, now() + interval '1 day')`;
    await m.users.setAnnotatorActive(ids.admin, ids.dan, false);
    const [row] = await m.sql<{ n: number }[]>`select count(*)::int as n from sessions where user_id = ${ids.dan}`;
    expect(row.n).toBe(0);
  });

  it("deleting a subtype moves its questions and topic to Uncategorised, and they can be filed again", async () => {
    const [u] = await m.sql<{ id: number; category_id: number }[]>`select id, category_id from subtypes where system`;
    const result = await m.taxonomy.deleteSubtype(subtype["8.1"]);
    expect(result).toEqual({ ok: true, questions: 2, topics: 1 });
    const moved = await m.sql<{ subtype_id: number; former_subtype: string; verifiability: string }[]>`
      select subtype_id, former_subtype, verifiability from questions where id in ${m.sql([question.dan1, question.dan2])}`;
    expect(moved.every((q) => q.subtype_id === u.id && q.former_subtype.startsWith("8.1 "))).toBe(true);
    const [kept] = await m.sql<{ code: string }[]>`select code from questions where id = ${question.dan1}`;
    expect(kept.code).toBe("04-8.1-001");
    const [topic] = await m.sql<{ category_id: number; subtype_id: number }[]>`
      select category_id, subtype_id from assignments where annotator_id = ${ids.dan} and sprint_id = ${sprintId}`;
    expect(topic).toEqual({ category_id: u.category_id, subtype_id: u.id });
    expect((await m.stats.questionDetail(question.dan1))?.uncategorised).toBe(true);

    expect((await m.taxonomy.deleteSubtype(u.id)).ok).toBe(false);
    expect((await m.taxonomy.deleteCategory(u.category_id)).ok).toBe(false);

    // Checked questions keep the verifiability they were checked under.
    expect(await m.taxonomy.moveQuestionToSubtype(question.dan1, subtype["8.2"])).toEqual({ ok: true, from: "04-8.1-001", to: "04-8.2-001" });
    const [filed] = await m.sql<{ subtype_id: number; former_subtype: string | null; verifiability: string }[]>`
      select subtype_id, former_subtype, verifiability from questions where id = ${question.dan1}`;
    expect(filed).toEqual({ subtype_id: subtype["8.2"], former_subtype: null, verifiability: moved[0].verifiability });
  });

  it("deletes a type only once its subtypes are gone", async () => {
    const [category] = await m.sql<{ id: number }[]>`insert into categories (code, name) values ('T', 'Temp') returning id`;
    const [st] = await m.sql<{ id: number }[]>`
      insert into subtypes (category_id, code, name, verifiability) values (${category.id}, 'T.1', 'Temp', 'V') returning id`;
    expect((await m.taxonomy.deleteCategory(category.id)).ok).toBe(false);
    expect((await m.taxonomy.deleteSubtype(st.id)).ok).toBe(true);
    expect((await m.taxonomy.deleteCategory(category.id)).ok).toBe(true);
  });

  it("deleting a model removes its answers", async () => {
    const [model] = await m.sql<{ id: number }[]>`insert into models (name, provider) values ('Temp model', 'Test') returning id`;
    await m.sql`insert into model_answers (question_id, model_id, chosen_option, source) values (${question.ann1}, ${model.id}, 'a', 'manual')`;
    expect((await m.models.listModels()).find((x) => x.id === model.id)?.answers).toBe(1);
    expect(await m.models.deleteModel(ids.admin, model.id)).toEqual({ ok: true });
    const [left] = await m.sql<{ n: number }[]>`select count(*)::int as n from model_answers where model_id = ${model.id}`;
    expect(left.n).toBe(0);
    expect((await m.models.deleteModel(ids.admin, model.id)).ok).toBe(false);
  });
});
