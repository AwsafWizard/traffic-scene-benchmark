import os from "node:os";
import { headers } from "next/headers";
import { getShareToken, requireBenchmarkerPage } from "@/lib/session";
import { CopyLink, RotateToken } from "./ShareControls";

export const dynamic = "force-dynamic";

/** The address another machine on the same network can actually reach. */
function lanAddress(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

export default async function SharePage() {
  await requireBenchmarkerPage();

  const token = getShareToken();
  const host = (await headers()).get("host") ?? "localhost:3000";
  const port = host.split(":")[1] ?? "3000";
  const lan = lanAddress();

  const localUrl = `http://${host}/join/${token}`;
  const lanUrl = lan ? `http://${lan}:${port}/join/${token}` : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Invite your grounder</h1>
        <p className="mt-1 text-sm text-muted">
          This link puts their browser into grounding mode: they see the queue and the questions,
          but not reference answers, model responses, or results.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
        {lanUrl ? (
          <div>
            <p className="mb-1.5 text-sm font-medium">Same Wi-Fi as you</p>
            <CopyLink url={lanUrl} />
            <p className="mt-2 text-xs text-muted">
              Works while your machine is awake, on the same network, and this server is running.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            No network address found — you may be offline. Others can&apos;t reach this machine
            right now.
          </p>
        )}

        <div className="border-t border-line pt-4">
          <p className="mb-1.5 text-sm font-medium">On this machine</p>
          <CopyLink url={localUrl} />
        </div>

        <div className="border-t border-line pt-4">
          <RotateToken />
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5 text-sm leading-relaxed text-muted">
        <p className="font-medium text-foreground">If they aren&apos;t on your network</p>
        <p className="mt-2">
          The link above only works on your local network. To reach someone elsewhere, expose this
          server with a tunnel — for example{" "}
          <code className="rounded bg-foreground/5 px-1 py-0.5 font-mono text-xs">
            cloudflared tunnel --url http://localhost:3000
          </code>{" "}
          — then hand them the public host with the same{" "}
          <code className="rounded bg-foreground/5 px-1 py-0.5 font-mono text-xs">
            /join/{token.slice(0, 6)}…
          </code>{" "}
          path. Anyone with that URL can answer questions, so treat it as a password.
        </p>
      </div>
    </div>
  );
}
