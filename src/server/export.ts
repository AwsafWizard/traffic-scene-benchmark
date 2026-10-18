import "server-only";
import { sql } from "./db";
import type { Option } from "./questions";
import { imageSrc } from "./storage";

/**
 * The dataset as files. Image links are signed Cloudinary URLs, so anyone holding
 * an export can open those images: treat exports as private.
 */

export interface ExportFilters {
  sprintId: number | null;
  status?: string;
}

export async function exportRecords(f: ExportFilters) {
  const questions = await sql`
    select q.id, q.code, q.prompt, q.options, q.correct_option, q.status, q.resolution, q.admin_note, q.verifiability,
      q.created_at, s.name as sprint, c.code as category_code, c.name as category_name,
      st.code as subtype_code, st.name as subtype_name, u.username as setter,
      i.id as image_id, i.storage, i.storage_key, i.version, i.width, i.height,
      i.source_repo, i.source_video, i.source_time
    from questions q join sprints s on s.id = q.sprint_id join subtypes st on st.id = q.subtype_id
    join categories c on c.id = st.category_id join users u on u.id = q.author_id join images i on i.id = q.image_id
    where ${f.sprintId ? sql`q.sprint_id = ${f.sprintId}` : sql`true`}
      and ${f.status ? sql`q.status = ${f.status}` : sql`q.status <> 'dropped'`}
    order by c.sort, st.sort, q.code`;
  const ids = questions.map((q) => q.id as string);
  if (ids.length === 0) return [];

  const checks = await sql`
    select c.question_id, u.username as checker, c.role, c.blind_choice, c.blind_note, c.judgment,
      c.judgment_reason, c.odd_one, extract(epoch from (c.blind_at - c.opened_at))::int as seconds
    from checks c join users u on u.id = c.checker_id where c.question_id = any(${ids}::uuid[])
    order by c.blind_at nulls last`;
  const tags = await sql`
    select q.id as question_id, g.name as group, t.name as tag from questions q
    join image_tags it on it.image_id = q.image_id join tags t on t.id = it.tag_id join tag_groups g on g.id = t.group_id
    where q.id = any(${ids}::uuid[]) order by g.sort, t.sort`;
  const models = await sql`
    select distinct on (a.question_id, a.model_id) a.question_id, m.name as model, m.model_id, a.chosen_option, a.source, a.error
    from model_answers a join models m on m.id = a.model_id where a.question_id = any(${ids}::uuid[])
    order by a.question_id, a.model_id, a.created_at desc`;

  return questions.map((q) => {
    const options = q.options as Option[];
    const text = (id: string | null) => (id ? (options.find((o) => o.id === id)?.text ?? id) : null);
    const tagMap: Record<string, string[]> = {};
    for (const t of tags.filter((t) => t.question_id === q.id)) (tagMap[t.group] ??= []).push(t.tag);
    return {
      id: q.id as string,
      code: q.code as string,
      sprint: q.sprint as string,
      category: { code: q.category_code as string, name: q.category_name as string },
      subtype: { code: q.subtype_code as string, name: q.subtype_name as string },
      verifiability: q.verifiability as string,
      question: q.prompt as string,
      options: options.map((o) => o.text),
      answer: text(q.correct_option),
      status: q.status as string,
      resolution: q.resolution as string | null,
      admin_note: q.admin_note as string | null,
      setter: q.setter as string,
      image: {
        id: q.image_id as string,
        url: imageSrc({ id: q.image_id, storage: q.storage, storage_key: q.storage_key, version: q.version }),
        width: q.width as number | null,
        height: q.height as number | null,
        source_repo: q.source_repo as string | null,
        source_video: q.source_video as string | null,
        source_time: q.source_time as number | null,
      },
      tags: tagMap,
      checks: checks
        .filter((c) => c.question_id === q.id)
        .map((c) => ({
          checker: c.checker as string,
          role: c.role as string | null,
          blind_answer: c.blind_choice === "none" || c.blind_choice === "cant_tell" ? c.blind_choice : text(c.blind_choice),
          blind_note: c.blind_note as string | null,
          judgment: c.judgment as string | null,
          reason: c.judgment_reason as string | null,
          odd_one: c.odd_one as string | null,
          seconds: c.seconds as number | null,
        })),
      model_answers: models
        .filter((m) => m.question_id === q.id)
        .map((m) => ({
          model: m.model as string,
          model_id: m.model_id as string | null,
          answer: text(m.chosen_option),
          correct: m.chosen_option === null ? null : m.chosen_option === q.correct_option,
          source: m.source as string,
          error: m.error as string | null,
        })),
      created_at: (q.created_at as Date).toISOString(),
    };
  });
}

type Record_ = Awaited<ReturnType<typeof exportRecords>>[number];

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(records: Record_[]): string {
  const header = [
    "code", "id", "sprint", "category", "subtype_code", "subtype", "verifiability", "status", "resolution",
    "question", "options", "answer", "setter", "image_url", "tags",
    "check1_checker", "check1_role", "check1_blind", "check1_judgment", "check1_reason",
    "check2_checker", "check2_role", "check2_blind", "check2_judgment", "check2_reason",
    "model_answers",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of records) {
    const check = (i: number) => {
      const c = r.checks[i];
      return c ? [c.checker, c.role, c.blind_note ? `${c.blind_answer}: ${c.blind_note}` : c.blind_answer, c.judgment, c.reason] : ["", "", "", "", ""];
    };
    lines.push(
      [
        r.code, r.id, r.sprint, `${r.category.code}. ${r.category.name}`, r.subtype.code, r.subtype.name, r.verifiability,
        r.status, r.resolution, r.question, r.options.join(" | "), r.answer, r.setter, r.image.url,
        Object.entries(r.tags).map(([g, t]) => `${g}: ${t.join(", ")}`).join("; "),
        ...check(0), ...check(1),
        r.model_answers.map((m) => `${m.model}=${m.answer ?? "error"}${m.correct === null ? "" : m.correct ? " (✓)" : " (✗)"}`).join("; "),
      ].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
