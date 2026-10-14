import { requireAdmin } from "@/server/auth";
import { getTagGroups, getTaxonomy, subtypeUsage, type Category, type Subtype } from "@/server/taxonomy";
import Link from "next/link";
import {
  deleteCategoryAction,
  deleteSubtypeAction,
  saveCategoryAction,
  saveSubtypeAction,
  saveTagAction,
  saveTagGroupAction,
} from "../../actions/admin";
import { PageHeader, VBadge } from "../../ui/components";
import SubmitButton from "../../ui/SubmitButton";
import { buttonDanger, buttonSecondary, card, hint, input, label, select } from "../../ui/styles";
import ActionForm from "../ActionForm";

export default async function TaxonomyPage() {
  await requireAdmin();
  const [all, groups, usage] = await Promise.all([getTaxonomy(), getTagGroups(), subtypeUsage()]);
  const taxonomy = all.filter((c) => !c.system);
  const uncategorised = all.find((c) => c.system)?.subtypes[0];
  const waiting = uncategorised ? usage.get(uncategorised.id) ?? 0 : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Taxonomy"
        sub="Types, subtypes and scene tags. Changes apply to new questions; existing questions keep the verifiability they were written with. Deleting a subtype moves its questions to Uncategorised, where you can file them again."
      />

      {taxonomy.map((category) => (
        <section key={category.id} className={`${card} ${category.active ? "" : "opacity-60"}`}>
          <details>
            <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
              <span className="font-medium">
                {category.code}. {category.name}
                {!category.active && <span className="ml-2 text-xs text-muted">(hidden)</span>}
              </span>
              <span className="text-xs text-accent">Edit type</span>
            </summary>
            <CategoryForm category={category} />
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
              {category.subtypes.length === 0 ? (
                <DeleteForm action={deleteCategoryAction} id={category.id} label="Delete type" confirm={`Delete type ${category.code}. ${category.name}?`} />
              ) : (
                <p className={hint}>To delete this type, delete its subtypes first.</p>
              )}
            </div>
          </details>
          <ul className="divide-y divide-line border-t border-line">
            {category.subtypes.map((s) => (
              <li key={s.id} className={s.active ? "" : "opacity-50"}>
                <details>
                  <summary className="flex cursor-pointer items-start gap-3 px-4 py-2.5 text-sm">
                    <span className="w-10 shrink-0 text-muted">{s.code}</span>
                    <VBadge v={s.verifiability} />
                    <span className="min-w-0 flex-1">
                      {s.name} {s.regional && "★"}
                      {s.keywords && <span className="block text-xs text-muted">{s.keywords}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {usage.get(s.id) ?? 0} questions{!s.active && " · hidden"}
                    </span>
                  </summary>
                  <SubtypeForm subtype={s} categories={taxonomy} used={(usage.get(s.id) ?? 0) > 0} />
                  <div className="bg-background/50 px-4 pb-4">
                    <DeleteForm
                      action={deleteSubtypeAction}
                      id={s.id}
                      label="Delete subtype"
                      confirm={
                        (usage.get(s.id) ?? 0) > 0
                          ? `Delete ${s.code} ${s.name}? Its ${usage.get(s.id)} question(s) move to Uncategorised.`
                          : `Delete ${s.code} ${s.name}?`
                      }
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <details className="border-t border-line">
            <summary className="cursor-pointer px-4 py-2.5 text-sm text-accent">+ Add a subtype to {category.code}</summary>
            <SubtypeForm categories={taxonomy} defaultCategory={category.id} nextSort={category.subtypes.length + 1} />
          </details>
        </section>
      ))}

      <details className={card}>
        <summary className="cursor-pointer p-4 text-sm text-accent">+ Add a type</summary>
        <CategoryForm nextSort={taxonomy.length + 1} />
      </details>

      {uncategorised && (
        <section className={`${card} flex flex-wrap items-center gap-3 p-4 text-sm`}>
          <span className="font-medium">Uncategorised</span>
          <span className="text-muted">
            {waiting === 0
              ? "Empty. Questions land here when their subtype is deleted."
              : `${waiting} question${waiting === 1 ? "" : "s"} from deleted subtypes, waiting to be filed under a subtype.`}
          </span>
          {waiting > 0 && (
            <Link href={`/admin/questions?sprint=all&subtype=${uncategorised.id}`} className={`${buttonSecondary} ml-auto`}>
              Review them
            </Link>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Scene tags</h2>
        <p className="text-sm text-muted">Annotators tag each image at upload. Required groups must have at least one tag before a question can be saved.</p>
        {groups.map((g) => (
          <div key={g.id} className={`${card} space-y-3 p-4 ${g.active ? "" : "opacity-60"}`}>
            <ActionForm action={saveTagGroupAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={g.id} />
              <input name="name" defaultValue={g.name} className={`${input} max-w-xs font-medium`} aria-label="Group name" />
              <input name="sort" type="number" defaultValue={g.sort} className={`${input} w-20`} aria-label="Order" />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="required" defaultChecked={g.required} /> Required</label>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={g.active} /> Shown</label>
              <SubmitButton className={buttonSecondary}>Save group</SubmitButton>
            </ActionForm>
            <div className="flex flex-wrap gap-2">
              {g.tags.map((t) => (
                <ActionForm key={t.id} action={saveTagAction} className={`flex items-center gap-1 rounded-full border border-line py-0.5 pl-2 pr-1 ${t.active ? "" : "opacity-50"}`}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="group_id" value={g.id} />
                  <input type="hidden" name="sort" value={t.sort} />
                  <input name="name" defaultValue={t.name} className="w-28 bg-transparent text-sm outline-none" aria-label="Tag name" />
                  <label className="flex items-center gap-1 text-xs text-muted" title="Shown"><input type="checkbox" name="active" defaultChecked={t.active} /></label>
                  <SubmitButton className="rounded-full px-2 text-xs text-accent hover:bg-background" pending="…">Save</SubmitButton>
                </ActionForm>
              ))}
              <ActionForm action={saveTagAction} className="flex items-center gap-1 rounded-full border border-dashed border-line py-0.5 pl-2 pr-1">
                <input type="hidden" name="group_id" value={g.id} />
                <input type="hidden" name="sort" value={g.tags.length + 1} />
                <input type="hidden" name="active" value="on" />
                <input name="name" placeholder="New tag" className="w-28 bg-transparent text-sm outline-none" aria-label="New tag" />
                <SubmitButton className="rounded-full px-2 text-xs text-accent hover:bg-background" pending="…">Add</SubmitButton>
              </ActionForm>
            </div>
          </div>
        ))}
        <ActionForm action={saveTagGroupAction} className={`${card} flex flex-wrap items-end gap-2 p-4`}>
          <input name="name" placeholder="New tag group" className={`${input} max-w-xs`} aria-label="New group name" />
          <input type="hidden" name="sort" value={groups.length + 1} />
          <input type="hidden" name="active" value="on" />
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="required" /> Required</label>
          <SubmitButton className={buttonSecondary}>Add group</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}

function CategoryForm({ category, nextSort = 0 }: { category?: Omit<Category, "subtypes">; nextSort?: number }) {
  return (
    <ActionForm action={saveCategoryAction} className="grid gap-3 border-t border-line p-4 sm:grid-cols-[6rem_1fr_6rem]">
      {category && <input type="hidden" name="id" value={category.id} />}
      <div>
        <label className={label}>Code</label>
        <input name="code" defaultValue={category?.code} required className={input} />
      </div>
      <div>
        <label className={label}>Name</label>
        <input name="name" defaultValue={category?.name} required className={input} />
      </div>
      <div>
        <label className={label}>Order</label>
        <input name="sort" type="number" defaultValue={category?.sort ?? nextSort} className={input} />
      </div>
      <div className="sm:col-span-3">
        <label className={label}>Description</label>
        <input name="description" defaultValue={category?.description ?? ""} className={input} />
      </div>
      <div className="flex items-center justify-between sm:col-span-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={category?.active ?? true} /> Shown to annotators</label>
        <SubmitButton>{category ? "Save type" : "Add type"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function SubtypeForm({
  subtype,
  categories,
  defaultCategory,
  nextSort = 0,
  used = false,
}: {
  subtype?: Subtype;
  categories: Category[];
  defaultCategory?: number;
  nextSort?: number;
  used?: boolean;
}) {
  return (
    <ActionForm action={saveSubtypeAction} className="grid gap-3 bg-background/50 p-4 sm:grid-cols-[6rem_1fr_10rem]">
      {subtype && <input type="hidden" name="id" value={subtype.id} />}
      <div>
        <label className={label}>Code</label>
        <input name="code" defaultValue={subtype?.code} required className={input} />
      </div>
      <div>
        <label className={label}>Name</label>
        <input name="name" defaultValue={subtype?.name} required className={input} />
      </div>
      <div>
        <label className={label}>Verifiability</label>
        <select name="verifiability" defaultValue={subtype?.verifiability ?? "V"} className={select}>
          <option value="V">V · Verifiable (1 checker)</option>
          <option value="C">C · Consensus (2 blind)</option>
          <option value="I">I · Inferential (2 in turn)</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className={label}>Keywords / example</label>
        <input name="keywords" defaultValue={subtype?.keywords ?? ""} className={input} />
      </div>
      <div>
        <label className={label}>Type</label>
        <select name="category_id" defaultValue={subtype?.category_id ?? defaultCategory} className={select} disabled={used}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.code}. {c.name}</option>
          ))}
        </select>
        {used && <input type="hidden" name="category_id" value={subtype!.category_id} />}
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="regional" defaultChecked={subtype?.regional} /> ★ matters more in South Asian traffic</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={subtype?.active ?? true} /> Shown to annotators</label>
        <label className="flex items-center gap-2 text-sm">Order <input name="sort" type="number" defaultValue={subtype?.sort ?? nextSort} className={`${input} w-20`} /></label>
        <span className="flex-1" />
        <SubmitButton>{subtype ? "Save subtype" : "Add subtype"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function DeleteForm({
  action,
  id,
  label,
  confirm,
}: {
  action: typeof deleteSubtypeAction;
  id: number;
  label: string;
  confirm: string;
}) {
  return (
    <ActionForm action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className={buttonDanger} confirm={confirm}>{label}</SubmitButton>
    </ActionForm>
  );
}
