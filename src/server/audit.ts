import "server-only";
import { sql, type Tx } from "./db";

/** Records an admin action. Pass the transaction when the change itself is in one. */
export async function audit(
  actorId: string | null,
  action: string,
  target: string | number | null,
  details?: Record<string, unknown>,
  tx?: Tx,
): Promise<void> {
  const run = tx ?? sql;
  await run`insert into audit_log (actor_id, action, target, details)
            values (${actorId}, ${action}, ${target === null ? null : String(target)},
                    ${details ? run.json(details as never) : null})`;
}
