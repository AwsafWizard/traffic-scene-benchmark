"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { runOneAction } from "../../../actions/admin";
import { Progress } from "../../../ui/components";
import { buttonSecondary } from "../../../ui/styles";

/**
 * Asks one model every sample question it hasn't answered yet, a few at a time,
 * from the browser. Each request is one question, so a slow model never hits a
 * server time limit, and closing the tab just stops the run.
 */
export default function Runner({ modelId, questionIds }: { modelId: number; questionIds: string[] }) {
  const router = useRouter();
  const stop = useRef(false);
  const [state, setState] = useState({ running: false, done: 0, failed: 0, lastError: "" });

  async function run() {
    stop.current = false;
    setState({ running: true, done: 0, failed: 0, lastError: "" });
    const queue = [...questionIds];
    const worker = async () => {
      while (queue.length && !stop.current) {
        const id = queue.shift()!;
        const result = await runOneAction(id, modelId);
        setState((s) => ({
          ...s,
          done: s.done + 1,
          failed: s.failed + (result.ok ? 0 : 1),
          lastError: result.ok ? s.lastError : (result.error ?? "Failed"),
        }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setState((s) => ({ ...s, running: false }));
    router.refresh();
  }

  if (questionIds.length === 0 && !state.running) return <p className="text-xs text-muted">Every sample question is answered.</p>;
  return (
    <div className="space-y-1.5">
      {state.running ? (
        <>
          <Progress value={state.done} max={questionIds.length} />
          <div className="flex items-center justify-between text-xs">
            <span>{state.done}/{questionIds.length}{state.failed > 0 && <span className="text-red-600"> · {state.failed} failed</span>}</span>
            <button type="button" className="text-red-600" onClick={() => (stop.current = true)}>Stop</button>
          </div>
        </>
      ) : (
        <button type="button" className={buttonSecondary} onClick={run}>
          Ask the {questionIds.length} unanswered by API
        </button>
      )}
      {state.lastError && <p className="text-xs text-red-600 dark:text-red-400" title={state.lastError}>Last error: {state.lastError.slice(0, 160)}</p>}
    </div>
  );
}
