import "server-only";
import { sql } from "./db";
import type { Verifiability } from "./engine";
import { fleissKappa, pairwiseAgreement } from "./metrics";
import type { Option } from "./questions";
import type { StoredImage } from "./storage";

/**
 * Statistics for the admin. Everything can be scoped to one sprint or taken
 * across all of them (sprintId null).
 */

const scope = (sprintId: number | null) => (sprintId ? sql`q.sprint_id = ${sprintId}` : sql`true`);

/** SQL for "this check has nothing left to do", mirroring engine.checkComplete. */
const COMPLETE = sql`(c.blind_choice is not null and (c.judgment is not null or not (
  q.verifiability = 'I' or (q.verifiability = 'V' and c.blind_choice <> q.correct_option))))`;

export interface StatusCounts {
  written: number;
  checking: number;
  accepted: number;
  flagged: number;
  returned: number;
  dropped: number;
  total: number;
}

function emptyCounts(): StatusCounts {
  return { written: 0, checking: 0, accepted: 0, flagged: 0, returned: 0, dropped: 0, total: 0 };
}

export interface SubtypeStat extends StatusCounts {
  category_code: string;
  category_name: string;
  subtype_id: number;
  code: string;
  name: string;
  verifiability: Verifiability;
}

export interface AgreementStats {
  V: { checked: number; matched: number; misread: number; setterMistake: number };
  C: { complete: number; allAgree: number; pairwise: number | null; kappa: number | null };
  I: { complete: number; blindMatchSecond: number; blindMatchThird: number; secondAgreed: number; thirdAllAgree: number; accepted: number };
}

export interface Overview {
  status: StatusCounts;
  byVerifiability: Record<Verifiability, StatusCounts>;
  bySubtype: SubtypeStat[];
  byTag: { group: string; tag: string; accepted: number; flagged: number; total: number }[];
  flagReasons: { reason: string; n: number }[];
  checks: { total: number; complete: number };
  agreement: AgreementStats;
  models: { model: string; answered: number; correct: number }[];
  sampleSize: number;
}

export async function overview(sprintId: number | null): Promise<Overview> {
  const where = scope(sprintId);

  const statusRows = await sql<{ status: keyof StatusCounts; verifiability: Verifiability; n: number }[]>`
    select status, verifiability, count(*)::int as n from questions q where ${where} group by status, verifiability`;
  const status = emptyCounts();
  const byVerifiability = { V: emptyCounts(), C: emptyCounts(), I: emptyCounts() };
  for (const r of statusRows) {
    status[r.status] += r.n;
    byVerifiability[r.verifiability][r.status] += r.n;
    if (r.status !== "dropped") {
      status.total += r.n;
      byVerifiability[r.verifiability].total += r.n;
    }
  }

  const bySubtype = await sql<SubtypeStat[]>`
    select c.code as category_code, c.name as category_name, st.id as subtype_id, st.code, st.name, st.verifiability,
      count(q.id) filter (where q.status = 'written')::int as written,
      count(q.id) filter (where q.status = 'checking')::int as checking,
      count(q.id) filter (where q.status = 'accepted')::int as accepted,
      count(q.id) filter (where q.status = 'flagged')::int as flagged,
      count(q.id) filter (where q.status = 'returned')::int as returned,
      count(q.id) filter (where q.status = 'dropped')::int as dropped,
      count(q.id) filter (where q.status <> 'dropped')::int as total
    from subtypes st join categories c on c.id = st.category_id
    left join questions q on q.subtype_id = st.id and ${where}
    group by c.code, c.name, c.sort, st.id, st.code, st.name, st.verifiability, st.sort
    order by c.sort, st.sort, st.code`;

  const byTag = await sql<{ group: string; tag: string; accepted: number; flagged: number; total: number }[]>`
    select g.name as group, t.name as tag,
      count(distinct q.id) filter (where q.status = 'accepted')::int as accepted,
      count(distinct q.id) filter (where q.status = 'flagged')::int as flagged,
      count(distinct q.id) filter (where q.status <> 'dropped')::int as total
    from tags t join tag_groups g on g.id = t.group_id
    join image_tags it on it.tag_id = t.id
    join questions q on q.image_id = it.image_id and ${where}
    group by g.name, g.sort, t.name, t.sort order by g.sort, t.sort`;

  const flagReasons = await sql<{ reason: string; n: number }[]>`
    select coalesce(resolution, 'unknown') as reason, count(*)::int as n from questions q
    where ${where} and status = 'flagged' group by resolution order by n desc`;

  const [checks] = await sql<{ total: number; complete: number }[]>`
    select count(*)::int as total, count(*) filter (where ${COMPLETE})::int as complete
    from checks c join questions q on q.id = c.question_id where ${where} and q.status <> 'dropped'`;

  const agreement = await agreementStats(sprintId);

  const models = await sql<{ model: string; answered: number; correct: number }[]>`
    select m.name as model, count(*)::int as answered,
      count(*) filter (where a.chosen_option = q.correct_option)::int as correct
    from (select distinct on (question_id, model_id) * from model_answers where error is null
          order by question_id, model_id, created_at desc) a
    join models m on m.id = a.model_id join questions q on q.id = a.question_id
    where ${where} and q.status <> 'dropped'
    group by m.name order by m.name`;

  const [{ n: sampleSize }] = await sql<{ n: number }[]>`
    select count(*)::int as n from model_samples ms join questions q on q.id = ms.question_id where ${where}`;

  return { status, byVerifiability, bySubtype, byTag, flagReasons, checks, agreement, models, sampleSize };
}

async function agreementStats(sprintId: number | null): Promise<AgreementStats> {
  const rows = await sql<{ question_id: string; verifiability: Verifiability; correct_option: string; status: string;
    role: string | null; blind_choice: string | null; judgment: string | null }[]>`
    select q.id as question_id, q.verifiability, q.correct_option, q.status, c.role, c.blind_choice, c.judgment
    from checks c join questions q on q.id = c.question_id
    where ${scope(sprintId)} and q.status <> 'dropped' and c.blind_choice is not null`;

  type Row = (typeof rows)[number];
  const byQuestion = new Map<string, Row[]>();
  for (const r of rows) byQuestion.set(r.question_id, [...(byQuestion.get(r.question_id) ?? []), r]);

  const stats: AgreementStats = {
    V: { checked: 0, matched: 0, misread: 0, setterMistake: 0 },
    C: { complete: 0, allAgree: 0, pairwise: null, kappa: null },
    I: { complete: 0, blindMatchSecond: 0, blindMatchThird: 0, secondAgreed: 0, thirdAllAgree: 0, accepted: 0 },
  };
  const cItems: string[][] = [];

  for (const checks of byQuestion.values()) {
    const q = checks[0];
    if (q.verifiability === "V") {
      const c = checks[0];
      if (c.blind_choice === q.correct_option) {
        stats.V.checked++;
        stats.V.matched++;
      } else if (c.judgment) {
        stats.V.checked++;
        if (c.judgment === "misread") stats.V.misread++;
        else stats.V.setterMistake++;
      }
    } else if (q.verifiability === "C" && checks.length === 2) {
      stats.C.complete++;
      const ratings = [q.correct_option, checks[0].blind_choice!, checks[1].blind_choice!];
      if (ratings.every((r) => r === ratings[0])) stats.C.allAgree++;
      cItems.push(ratings);
    } else if (q.verifiability === "I") {
      const second = checks.find((c) => c.role === "second");
      const third = checks.find((c) => c.role === "third");
      if (!second?.judgment || !third?.judgment) continue;
      stats.I.complete++;
      if (second.blind_choice === q.correct_option) stats.I.blindMatchSecond++;
      if (third.blind_choice === q.correct_option) stats.I.blindMatchThird++;
      if (second.judgment === "agree") stats.I.secondAgreed++;
      if (third.judgment === "all_agree") stats.I.thirdAllAgree++;
      if (second.judgment === "agree" && third.judgment === "all_agree") stats.I.accepted++;
    }
  }
  stats.C.pairwise = pairwiseAgreement(cItems);
  stats.C.kappa = fleissKappa(cItems);
  return stats;
}

// Per annotator ---------------------------------------------------------------------------

export interface AnnotatorRow {
  id: string;
  display_name: string;
  username: string;
  active: boolean;
  written: number;
  accepted: number;
  flagged: number;
  checks_total: number;
  checks_done: number;
  blind_answers: number;
  blind_matches: number;
  avg_seconds: number | null;
}

export async function annotatorTable(sprintId: number | null): Promise<AnnotatorRow[]> {
  const where = scope(sprintId);
  return sql<AnnotatorRow[]>`
    select u.id, u.display_name, u.username, u.active,
      coalesce(w.written, 0)::int as written, coalesce(w.accepted, 0)::int as accepted, coalesce(w.flagged, 0)::int as flagged,
      coalesce(k.total, 0)::int as checks_total, coalesce(k.done, 0)::int as checks_done,
      coalesce(k.blind, 0)::int as blind_answers, coalesce(k.matches, 0)::int as blind_matches, k.avg_seconds
    from users u
    left join (
      select q.author_id, count(*) filter (where q.status <> 'dropped') as written,
        count(*) filter (where q.status = 'accepted') as accepted, count(*) filter (where q.status = 'flagged') as flagged
      from questions q where ${where} group by q.author_id
    ) w on w.author_id = u.id
    left join (
      select c.checker_id, count(*) as total, count(*) filter (where ${COMPLETE}) as done,
        count(*) filter (where c.blind_choice is not null) as blind,
        count(*) filter (where c.blind_choice = q.correct_option) as matches,
        round(avg(extract(epoch from (c.blind_at - c.opened_at))) filter (where c.blind_at is not null)::numeric, 1)::float as avg_seconds
      from checks c join questions q on q.id = c.question_id where ${where} and q.status <> 'dropped'
      group by c.checker_id
    ) k on k.checker_id = u.id
    where u.role = 'annotator'
    order by u.active desc, u.display_name`;
}

export interface AnnotatorDetail {
  bySubtype: { code: string; name: string; verifiability: Verifiability; written: number; accepted: number; flagged: number }[];
  flagReasons: { reason: string; n: number }[];
  judgments: { judgment: string; n: number }[];
  specials: { choice: string; n: number }[];
  recentReasons: { question_id: string; subtype: string; kind: string; text: string; at: Date }[];
  activity: { day: string; written: number; checked: number }[];
}

export async function annotatorDetail(userId: string, sprintId: number | null): Promise<AnnotatorDetail> {
  const where = scope(sprintId);
  const bySubtype = await sql<AnnotatorDetail["bySubtype"]>`
    select st.code, st.name, q.verifiability,
      count(*) filter (where q.status <> 'dropped')::int as written,
      count(*) filter (where q.status = 'accepted')::int as accepted,
      count(*) filter (where q.status = 'flagged')::int as flagged
    from questions q join subtypes st on st.id = q.subtype_id
    where q.author_id = ${userId} and ${where}
    group by st.code, st.name, st.sort, q.verifiability order by st.code`;
  const flagReasons = await sql<{ reason: string; n: number }[]>`
    select coalesce(resolution, 'unknown') as reason, count(*)::int as n from questions q
    where q.author_id = ${userId} and ${where} and q.status = 'flagged' group by resolution order by n desc`;
  const judgments = await sql<{ judgment: string; n: number }[]>`
    select c.judgment, count(*)::int as n from checks c join questions q on q.id = c.question_id
    where c.checker_id = ${userId} and ${where} and c.judgment is not null group by c.judgment order by n desc`;
  const specials = await sql<{ choice: string; n: number }[]>`
    select c.blind_choice as choice, count(*)::int as n from checks c join questions q on q.id = c.question_id
    where c.checker_id = ${userId} and ${where} and c.blind_choice in ('none', 'cant_tell') group by c.blind_choice`;
  const recentReasons = await sql<AnnotatorDetail["recentReasons"]>`
    select * from (
      select q.id as question_id, st.code as subtype, c.judgment as kind, c.judgment_reason as text, c.judged_at as at
      from checks c join questions q on q.id = c.question_id join subtypes st on st.id = q.subtype_id
      where c.checker_id = ${userId} and ${where} and c.judgment_reason is not null
      union all
      select q.id, st.code, c.blind_choice, c.blind_note, c.blind_at
      from checks c join questions q on q.id = c.question_id join subtypes st on st.id = q.subtype_id
      where c.checker_id = ${userId} and ${where} and c.blind_note is not null
    ) r order by at desc limit 25`;
  const activity = await sql<AnnotatorDetail["activity"]>`
    with days as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day)
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*)::int from questions q where q.author_id = ${userId} and q.created_at::date = d.day and ${where}) as written,
      (select count(*)::int from checks c join questions q on q.id = c.question_id
        where c.checker_id = ${userId} and c.blind_at::date = d.day and ${where}) as checked
    from days d order by d.day`;
  return { bySubtype, flagReasons, judgments, specials, recentReasons, activity };
}

// One question -------------------------------------------------------------------------------

export interface QuestionDetail {
  id: string;
  prompt: string;
  options: Option[];
  correct_option: string;
  status: string;
  resolution: string | null;
  admin_note: string | null;
  verifiability: Verifiability;
  created_at: Date;
  updated_at: Date;
  sprint_id: number;
  sprint_name: string;
  author_id: string;
  author_name: string;
  category: string;
  subtype: string;
  image: StoredImage;
  tags: { group: string; tag: string }[];
  in_sample: boolean;
  checks: {
    id: string;
    checker_name: string;
    role: string | null;
    option_order: string[];
    blind_choice: string | null;
    blind_note: string | null;
    judgment: string | null;
    judgment_reason: string | null;
    odd_one: string | null;
    opened_at: Date | null;
    blind_at: Date | null;
    judged_at: Date | null;
  }[];
  modelAnswers: { id: string; model: string; chosen_option: string | null; raw_output: string | null; source: string; error: string | null; created_at: Date }[];
  history: { action: string; actor: string | null; details: unknown; created_at: Date }[];
}

export async function questionDetail(id: string): Promise<QuestionDetail | null> {
  const [q] = await sql`
    select q.*, s.name as sprint_name, u.display_name as author_name,
      c.code || '. ' || c.name as category, st.code || ' ' || st.name as subtype,
      i.storage, i.storage_key, i.version,
      exists (select 1 from model_samples ms where ms.question_id = q.id) as in_sample
    from questions q join sprints s on s.id = q.sprint_id join users u on u.id = q.author_id
    join subtypes st on st.id = q.subtype_id join categories c on c.id = st.category_id
    join images i on i.id = q.image_id where q.id = ${id}`;
  if (!q) return null;
  const tags = await sql<{ group: string; tag: string }[]>`
    select g.name as group, t.name as tag from image_tags it join tags t on t.id = it.tag_id
    join tag_groups g on g.id = t.group_id where it.image_id = ${q.image_id} order by g.sort, t.sort`;
  const checks = await sql<QuestionDetail["checks"]>`
    select c.id, u.display_name as checker_name, c.role, c.option_order, c.blind_choice, c.blind_note,
      c.judgment, c.judgment_reason, c.odd_one, c.opened_at, c.blind_at, c.judged_at
    from checks c join users u on u.id = c.checker_id where c.question_id = ${id}
    order by c.blind_at nulls last, c.created_at`;
  const modelAnswers = await sql<QuestionDetail["modelAnswers"]>`
    select a.id, m.name as model, a.chosen_option, a.raw_output, a.source, a.error, a.created_at
    from model_answers a join models m on m.id = a.model_id where a.question_id = ${id} order by a.created_at desc`;
  const history = await sql<QuestionDetail["history"]>`
    select l.action, u.display_name as actor, l.details, l.created_at from audit_log l
    left join users u on u.id = l.actor_id where l.target = ${id} order by l.created_at desc`;
  return {
    ...(q as unknown as QuestionDetail),
    image: { id: q.image_id, storage: q.storage, storage_key: q.storage_key, version: q.version },
    tags,
    checks,
    modelAnswers,
    history,
  };
}
