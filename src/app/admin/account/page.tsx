import { requireAdmin } from "@/server/auth";
import { sql } from "@/server/db";
import { changePasswordAction } from "../../actions/admin";
import { PageHeader } from "../../ui/components";
import SubmitButton from "../../ui/SubmitButton";
import { card, input, label, td, th } from "../../ui/styles";
import ActionForm from "../ActionForm";

export default async function AccountPage() {
  const me = await requireAdmin();
  const log = await sql<{ action: string; actor: string | null; target: string | null; created_at: Date }[]>`
    select l.action, u.display_name as actor, l.target, l.created_at from audit_log l
    left join users u on u.id = l.actor_id order by l.created_at desc limit 100`;

  return (
    <div className="space-y-6">
      <PageHeader title="Admin account" sub={`Signed in as ${me.username}`} />
      <ActionForm action={changePasswordAction} className={`${card} grid max-w-md gap-3 p-5`}>
        <h2 className="font-medium">Change your password</h2>
        <div>
          <label className={label} htmlFor="current">Current password</label>
          <input id="current" name="current" type="password" autoComplete="current-password" required className={input} />
        </div>
        <div>
          <label className={label} htmlFor="next">New password</label>
          <input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required className={input} />
        </div>
        <div>
          <label className={label} htmlFor="confirm">New password again</label>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className={input} />
        </div>
        <SubmitButton>Change password</SubmitButton>
        <p className="text-xs text-muted">
          Lost it? Whoever manages the deployment can reset it from the server: set ADMIN_PASSWORD and run{" "}
          <code>npm run db:migrate -- --reset-admin</code>.
        </p>
      </ActionForm>

      <section className={`${card} overflow-x-auto`}>
        <h2 className="px-4 pt-4 font-medium">Activity log</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Who</th>
              <th className={th}>Action</th>
              <th className={th}>Target</th>
            </tr>
          </thead>
          <tbody>
            {log.map((l, i) => (
              <tr key={i}>
                <td className={`${td} whitespace-nowrap text-muted`}>{l.created_at.toLocaleString()}</td>
                <td className={td}>{l.actor ?? "server"}</td>
                <td className={td}>{l.action}</td>
                <td className={`${td} font-mono text-xs text-muted`}>{l.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
