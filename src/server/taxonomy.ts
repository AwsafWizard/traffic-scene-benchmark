import "server-only";
import { sql, type Tx } from "./db";
import type { Verifiability } from "./engine";

export interface Subtype {
  id: number;
  category_id: number;
  code: string;
  name: string;
  keywords: string | null;
  verifiability: Verifiability;
  regional: boolean;
  sort: number;
  active: boolean;
  system: boolean;
}

export interface Category {
  id: number;
  code: string;
  name: string;
  description: string | null;
  sort: number;
  active: boolean;
  system: boolean;
  subtypes: Subtype[];
}

export interface Tag {
  id: number;
  group_id: number;
  name: string;
  sort: number;
  active: boolean;
}

export interface TagGroup {
  id: number;
  name: string;
  required: boolean;
  sort: number;
  active: boolean;
  tags: Tag[];
}

/** Categories with their subtypes, in display order. */
export async function getTaxonomy({ activeOnly = false } = {}): Promise<Category[]> {
  const categories = await sql<Omit<Category, "subtypes">[]>`
    select id, code, name, description, sort, active, system from categories
    where ${activeOnly ? sql`active` : sql`true`}
    order by sort, code`;
  const subtypes = await sql<Subtype[]>`
    select id, category_id, code, name, keywords, verifiability, regional, sort, active, system from subtypes
    where ${activeOnly ? sql`active` : sql`true`}
    order by sort, code`;
  return categories.map((c) => ({ ...c, subtypes: subtypes.filter((s) => s.category_id === c.id) }));
}

export async function getTagGroups({ activeOnly = false } = {}): Promise<TagGroup[]> {
  const groups = await sql<Omit<TagGroup, "tags">[]>`
    select id, name, required, sort, active from tag_groups
    where ${activeOnly ? sql`active` : sql`true`} order by sort, name`;
  const tags = await sql<Tag[]>`
    select id, group_id, name, sort, active from tags
    where ${activeOnly ? sql`active` : sql`true`} order by sort, name`;
  return groups.map((g) => ({ ...g, tags: tags.filter((t) => t.group_id === g.id) }));
}

/** How many questions and assignments use each subtype, so the editor can warn before changes. */
export async function subtypeUsage(): Promise<Map<number, number>> {
  const rows = await sql<{ subtype_id: number; n: number }[]>`
    select subtype_id, count(*)::int as n from questions group by subtype_id`;
  return new Map(rows.map((r) => [r.subtype_id, r.n]));
}

/** Subtype ids a topic covers: one subtype, or every subtype in the category. */
export async function topicSubtypeIds(categoryId: number, subtypeId: number | null): Promise<number[]> {
  if (subtypeId) return [subtypeId];
  const rows = await sql<{ id: number }[]>`select id from subtypes where category_id = ${categoryId}`;
  return rows.map((r) => r.id);
}

// Editing (admin only; callers check the role) ---------------------------------------------

type Saved = { ok: true } | { ok: false; error: string };
const bad = (error: string): Saved => ({ ok: false, error });

export async function saveCategory(input: { id?: number; code: string; name: string; description: string; sort: number; active: boolean }): Promise<Saved> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) return bad("A type needs a code and a name.");
  const [clash] = await sql`select 1 from categories where code = ${code} and id <> ${input.id ?? 0}`;
  if (clash) return bad(`Code ${code} is already used.`);
  if (input.id) {
    await sql`update categories set code = ${code}, name = ${name}, description = ${input.description.trim() || null},
              sort = ${input.sort}, active = ${input.active} where id = ${input.id}`;
  } else {
    await sql`insert into categories (code, name, description, sort, active)
              values (${code}, ${name}, ${input.description.trim() || null}, ${input.sort}, ${input.active})`;
  }
  return { ok: true };
}

export async function saveSubtype(input: {
  id?: number; category_id: number; code: string; name: string; keywords: string;
  verifiability: string; regional: boolean; sort: number; active: boolean;
}): Promise<Saved> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) return bad("A subtype needs a code and a name.");
  if (!["V", "C", "I"].includes(input.verifiability)) return bad("Pick V, C or I.");
  const [category] = await sql`select 1 from categories where id = ${input.category_id}`;
  if (!category) return bad("Pick the type it belongs to.");
  const [clash] = await sql`select 1 from subtypes where code = ${code} and id <> ${input.id ?? 0}`;
  if (clash) return bad(`Code ${code} is already used.`);
  if (input.id) {
    const [current] = await sql<{ category_id: number }[]>`select category_id from subtypes where id = ${input.id}`;
    if (current && current.category_id !== input.category_id) {
      const [used] = await sql`select 1 from questions where subtype_id = ${input.id}`;
      if (used) return bad("Questions use this subtype, so it can't move to another type.");
    }
    await sql`update subtypes set category_id = ${input.category_id}, code = ${code}, name = ${name},
              keywords = ${input.keywords.trim() || null}, verifiability = ${input.verifiability},
              regional = ${input.regional}, sort = ${input.sort}, active = ${input.active} where id = ${input.id}`;
  } else {
    await sql`insert into subtypes (category_id, code, name, keywords, verifiability, regional, sort, active)
              values (${input.category_id}, ${code}, ${name}, ${input.keywords.trim() || null}, ${input.verifiability},
                      ${input.regional}, ${input.sort}, ${input.active})`;
  }
  return { ok: true };
}

export async function saveTagGroup(input: { id?: number; name: string; required: boolean; sort: number; active: boolean }): Promise<Saved> {
  const name = input.name.trim();
  if (!name) return bad("Give the group a name.");
  const [clash] = await sql`select 1 from tag_groups where lower(name) = lower(${name}) and id <> ${input.id ?? 0}`;
  if (clash) return bad("That group already exists.");
  if (input.id) {
    await sql`update tag_groups set name = ${name}, required = ${input.required}, sort = ${input.sort}, active = ${input.active}
              where id = ${input.id}`;
  } else {
    await sql`insert into tag_groups (name, required, sort, active) values (${name}, ${input.required}, ${input.sort}, ${input.active})`;
  }
  return { ok: true };
}

export async function saveTag(input: { id?: number; group_id: number; name: string; sort: number; active: boolean }): Promise<Saved> {
  const name = input.name.trim();
  if (!name) return bad("Give the tag a name.");
  const [clash] = await sql`select 1 from tags where group_id = ${input.group_id} and lower(name) = lower(${name}) and id <> ${input.id ?? 0}`;
  if (clash) return bad("That tag already exists in this group.");
  if (input.id) {
    await sql`update tags set name = ${name}, sort = ${input.sort}, active = ${input.active} where id = ${input.id}`;
  } else {
    await sql`insert into tags (group_id, name, sort, active) values (${input.group_id}, ${name}, ${input.sort}, ${input.active})`;
  }
  return { ok: true };
}

// Deleting -------------------------------------------------------------------------------

async function uncategorised(tx: Tx) {
  const [row] = await tx<{ category_id: number; subtype_id: number }[]>`
    select c.id as category_id, s.id as subtype_id from categories c join subtypes s on s.category_id = c.id
    where c.system and s.system limit 1`;
  if (!row) throw new Error("The built-in Uncategorised type is missing; run the database migrations.");
  return row;
}

/**
 * Deletes a subtype. Its questions move to the built-in Uncategorised type,
 * remembering the subtype they came from, and topics assigned to it move too.
 */
export async function deleteSubtype(id: number): Promise<{ ok: true; questions: number; topics: number } | { ok: false; error: string }> {
  return sql.begin(async (tx) => {
    const [subtype] = await tx<{ code: string; name: string; system: boolean }[]>`
      select code, name, system from subtypes where id = ${id} for update`;
    if (!subtype) return { ok: false as const, error: "Subtype not found." };
    if (subtype.system) return { ok: false as const, error: "The Uncategorised subtype can't be deleted." };
    const target = await uncategorised(tx);
    const moved = await tx`
      update questions set subtype_id = ${target.subtype_id},
        former_subtype = coalesce(former_subtype, ${`${subtype.code} ${subtype.name}`}), updated_at = now()
      where subtype_id = ${id}`;
    const topics = await tx`
      update assignments set subtype_id = ${target.subtype_id}, category_id = ${target.category_id}
      where subtype_id = ${id}`;
    await tx`delete from subtypes where id = ${id}`;
    return { ok: true as const, questions: moved.count, topics: topics.count };
  });
}

/** Deletes a type once its subtypes are gone. Whole-type topics move to Uncategorised. */
export async function deleteCategory(id: number): Promise<Saved & { topics?: number }> {
  return sql.begin(async (tx) => {
    const [category] = await tx<{ system: boolean }[]>`select system from categories where id = ${id} for update`;
    if (!category) return bad("Type not found.");
    if (category.system) return bad("The Uncategorised type can't be deleted.");
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from subtypes where category_id = ${id}`;
    if (n > 0) return bad("Delete this type's subtypes first (their questions move to Uncategorised).");
    const target = await uncategorised(tx);
    const topics = await tx`update assignments set category_id = ${target.category_id} where category_id = ${id}`;
    await tx`delete from categories where id = ${id}`;
    return { ok: true as const, topics: topics.count };
  });
}

/**
 * Files a question under another subtype, which gives it a new code. A question not yet sent for checking
 * takes the new subtype's verifiability; one already checked keeps the
 * verifiability it was checked under.
 */
export async function moveQuestionToSubtype(questionId: string, subtypeId: number): Promise<Saved & { from?: string; to?: string }> {
  const [subtype] = await sql<{ verifiability: string }[]>`select verifiability from subtypes where id = ${subtypeId}`;
  if (!subtype) return bad("Pick a subtype.");
  // The database gives the question a new code for its new subtype.
  const [row] = await sql<{ from: string; to: string }[]>`
    update questions q set subtype_id = ${subtypeId},
      verifiability = case when q.status = 'written' then ${subtype.verifiability} else q.verifiability end,
      former_subtype = null, updated_at = now()
    from (select id, code from questions where id = ${questionId}) old
    where q.id = old.id
    returning old.code as from, q.code as to`;
  return row ? { ok: true, from: row.from, to: row.to } : bad("Question not found.");
}
