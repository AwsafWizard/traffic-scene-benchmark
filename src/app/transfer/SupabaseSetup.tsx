const SQL = `create policy "bench read"   on storage.objects for select
  using (bucket_id = 'traffic-bench');
create policy "bench insert" on storage.objects for insert
  with check (bucket_id = 'traffic-bench');
create policy "bench update" on storage.objects for update
  using (bucket_id = 'traffic-bench');`;

const STEPS = [
  {
    title: "Make a free Supabase project",
    body: (
      <>
        Go to{" "}
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          supabase.com/dashboard
        </a>
        , sign in with GitHub or email, and click <strong>New project</strong>. Any name and
        region will do. No card needed. It takes a minute or two to finish setting up.
      </>
    ),
  },
  {
    title: "Make a bucket called traffic-bench",
    body: (
      <>
        In the left sidebar click <strong>Storage</strong> → <strong>New bucket</strong>. Name it
        exactly <code className="rounded bg-foreground/10 px-1 font-mono">traffic-bench</code> and
        leave it private.
      </>
    ),
  },
  {
    title: "Let both copies use that bucket",
    body: (
      <>
        In the sidebar click <strong>SQL Editor</strong>, paste this in, and press{" "}
        <strong>Run</strong>:
        <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-background p-3 text-xs leading-relaxed">
          {SQL}
        </pre>
      </>
    ),
  },
  {
    title: "Copy the two values",
    body: (
      <>
        Sidebar → <strong>Project Settings</strong> → <strong>API</strong>. You need{" "}
        <strong>Project URL</strong> and, under Project API keys, the one labelled{" "}
        <code className="rounded bg-foreground/10 px-1 font-mono">anon</code>{" "}
        <code className="rounded bg-foreground/10 px-1 font-mono">public</code>. Not the{" "}
        <code className="rounded bg-foreground/10 px-1 font-mono">service_role</code> key — that
        one bypasses every access rule.
      </>
    ),
  },
  {
    title: "Paste them into .env.local and restart",
    body: (
      <>
        Open <code className="rounded bg-foreground/10 px-1 font-mono">.env.local</code> in the
        project folder and fill in the two blank lines:
        <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-background p-3 text-xs leading-relaxed">
          {`SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...`}
        </pre>
        <span className="mt-2 block">
          Then stop the dev server (Ctrl+C) and run{" "}
          <code className="rounded bg-foreground/10 px-1 font-mono">npm run dev</code> again —
          env changes only load at startup. Refresh this page and Cloud sync will be selectable.
        </span>
      </>
    ),
  },
];

/** Shown on the Transfer page until the Supabase keys are present. */
export default function SupabaseSetup() {
  return (
    <details className="rounded-lg border border-line bg-background p-4">
      <summary className="cursor-pointer text-sm font-medium">
        How do I set up cloud sync? — five steps, about four minutes
      </summary>

      <ol className="mt-4 space-y-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{step.title}</p>
              <div className="mt-1 text-sm leading-relaxed text-muted">{step.body}</div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-muted">
        Your partner does <strong>none</strong> of this — they just put the same two values in
        their own <code className="rounded bg-foreground/10 px-1 font-mono">.env.local</code>.
        Anyone holding them can read and write the bucket, so treat the anon key like a shared
        password. Your reference answers and private notes are never uploaded.
      </p>
    </details>
  );
}
