import { requireAdmin } from "@/server/auth";
import { listSprints } from "@/server/sprints";
import { PageHeader } from "../../ui/components";
import { button, card, hint, label, select } from "../../ui/styles";

export default async function ExportPage({ searchParams }: PageProps<"/admin/export">) {
  await requireAdmin();
  const sprints = await listSprints();
  const { sprint } = await searchParams;

  return (
    <div className="space-y-6">
      <PageHeader title="Export" sub="Download questions with their answers, every check, scene tags and model answers." />
      <form action="/admin/export/download" method="get" className={`${card} grid gap-4 p-5 sm:grid-cols-3`}>
        <div>
          <label className={label} htmlFor="sprint">Sprint</label>
          <select id="sprint" name="sprint" defaultValue={typeof sprint === "string" ? sprint : ""} className={select}>
            <option value="">All sprints</option>
            {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="status">Questions</label>
          <select id="status" name="status" className={select}>
            <option value="accepted">Accepted only (the benchmark)</option>
            <option value="">Everything except dropped</option>
            <option value="flagged">Flagged only</option>
            <option value="dropped">Dropped only</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="format">Format</label>
          <select id="format" name="format" className={select}>
            <option value="json">JSON (nested, full detail)</option>
            <option value="csv">CSV (one row per question)</option>
          </select>
        </div>
        <div className="sm:col-span-3">
          <button type="submit" className={button}>Download</button>
          <p className={hint}>
            Image links in the file are signed, so anyone with the file can open those images. Keep exports private. Every export is logged.
          </p>
        </div>
      </form>
    </div>
  );
}
