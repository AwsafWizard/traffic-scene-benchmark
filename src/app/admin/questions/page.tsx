import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { FLAG_LABEL, type FlagReason } from "@/server/engine";
import { ADMIN_PAGE_SIZE, adminListQuestions } from "@/server/questions";
import { imageSrc } from "@/server/storage";
import { getTaxonomy } from "@/server/taxonomy";
import { listAnnotators } from "@/server/users";
import { PageHeader, StatusBadge, VBadge } from "../../ui/components";
import { buttonSecondary, card, input, select } from "../../ui/styles";
import { resolveScope } from "../scope";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AdminQuestionsPage({ searchParams }: PageProps<"/admin/questions">) {
  await requireAdmin();
  const params = await searchParams;
  const { sprints, sprintId, value } = await resolveScope(params.sprint);
  const status = one(params.status);
  const subtype = one(params.subtype);
  const v = one(params.v);
  const author = one(params.author);
  const search = one(params.q);
  const page = Math.max(1, Number(one(params.page)) || 1);

  const [{ rows, total }, taxonomy, annotators] = await Promise.all([
    adminListQuestions({
      sprintId,
      status: status || undefined,
      subtypeId: Number(subtype) || undefined,
      verifiability: v || undefined,
      authorId: /^[0-9a-f-]{36}$/.test(author) ? author : undefined,
      search: search || undefined,
      page,
    }),
    getTaxonomy(),
    listAnnotators(),
  ]);
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const pageHref = (p: number) => `/admin/questions?${new URLSearchParams({ sprint: value, status, subtype, v, author, q: search, page: String(p) })}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Questions" sub={`${total} matching · flagged ones first`} />

      <form className={`${card} grid gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6`}>
        <select name="sprint" defaultValue={value} className={select} aria-label="Sprint">
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="all">All sprints</option>
        </select>
        <select name="status" defaultValue={status} className={select} aria-label="Status">
          <option value="">Any status</option>
          {["flagged", "returned", "checking", "accepted", "written", "dropped"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="subtype" defaultValue={subtype} className={select} aria-label="Subtype">
          <option value="">Any subtype</option>
          {taxonomy.map((c) => (
            <optgroup key={c.id} label={`${c.code}. ${c.name}`}>
              {c.subtypes.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
            </optgroup>
          ))}
        </select>
        <select name="v" defaultValue={v} className={select} aria-label="Verifiability">
          <option value="">V, C and I</option>
          <option value="V">V only</option>
          <option value="C">C only</option>
          <option value="I">I only</option>
        </select>
        <select name="author" defaultValue={author} className={select} aria-label="Setter">
          <option value="">Any setter</option>
          {annotators.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
        </select>
        <div className="flex gap-2">
          <input name="q" defaultValue={search} placeholder="Search text" className={input} />
          <button type="submit" className={buttonSecondary}>Filter</button>
        </div>
      </form>

      <ul className="space-y-2">
        {rows.length === 0 && <li className={`${card} p-6 text-center text-sm text-muted`}>No questions match.</li>}
        {rows.map((q) => (
          <li key={q.id}>
            <Link href={`/admin/questions/${q.id}`} className={`${card} flex gap-4 p-3 transition hover:border-accent`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageSrc(q.image, 240)} alt="" className="h-16 w-24 shrink-0 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StatusBadge status={q.status} />
                  <VBadge v={q.verifiability} />
                  <span>{q.subtype_code}</span>
                  <span>· {q.author_name}</span>
                  <span>· {q.sprint_name}</span>
                  {q.checks_total > 0 && <span>· checks {q.checks_done}/{q.checks_total}</span>}
                </div>
                <p className="mt-1 truncate text-sm">{q.prompt}</p>
                {q.status === "flagged" && q.resolution && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {FLAG_LABEL[q.resolution as FlagReason] ?? (q.resolution === "resubmitted" ? "Fixed by the setter — review it" : q.resolution)}
                  </p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 && <Link href={pageHref(page - 1)} className={buttonSecondary}>Previous</Link>}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages && <Link href={pageHref(page + 1)} className={buttonSecondary}>Next</Link>}
        </div>
      )}
    </div>
  );
}
