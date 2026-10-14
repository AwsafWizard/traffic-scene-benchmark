/**
 * Choosing the two checkers for each topic.
 *
 * A topic is one assignment: a whole category or one subtype, given to one
 * annotator. Its checkers must not have written in it, which means nobody whose
 * own topics in this sprint share a subtype with it. Within that rule the draw is
 * random but balanced: each topic goes to the two eligible people with the least
 * checking work so far, ties broken at random, biggest topics first.
 */

export interface DrawTopic {
  assignmentId: number;
  authorId: string;
  /** Every subtype the topic covers (all of a category's, for a whole-category topic). */
  subtypeIds: number[];
  /** Checks each of its two checkers will do: every C and I question, half the V ones. */
  loadPerChecker: number;
}

export type DrawOutcome =
  | { ok: true; slots: { assignmentId: number; checkerIds: [string, string] }[] }
  | { ok: false; assignmentId: number; error: string };

/**
 * Runs the greedy draw many times and keeps the most even result (smallest
 * heaviest load, then smallest spread), since a single greedy pass can leave the
 * last topic with only overloaded candidates.
 */
export function drawCheckers(
  topics: DrawTopic[],
  annotatorIds: string[],
  random: () => number = Math.random,
  attempts = 200,
): DrawOutcome {
  let best: { outcome: DrawOutcome; score: [number, number] } | null = null;
  for (let i = 0; i < attempts; i++) {
    const outcome = drawOnce(topics, annotatorIds, random);
    if (!outcome.ok) return outcome;
    const load = new Map(annotatorIds.map((id) => [id, 0]));
    for (const slot of outcome.slots) {
      const per = topics.find((t) => t.assignmentId === slot.assignmentId)!.loadPerChecker;
      for (const c of slot.checkerIds) load.set(c, load.get(c)! + per);
    }
    const values = [...load.values()];
    const score: [number, number] = [Math.max(...values), values.reduce((s, v) => s + v * v, 0)];
    if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
      best = { outcome, score };
    }
  }
  return best!.outcome;
}

function drawOnce(topics: DrawTopic[], annotatorIds: string[], random: () => number): DrawOutcome {
  const written = new Map<string, Set<number>>();
  for (const topic of topics) {
    const set = written.get(topic.authorId) ?? new Set<number>();
    topic.subtypeIds.forEach((id) => set.add(id));
    written.set(topic.authorId, set);
  }

  const load = new Map(annotatorIds.map((id) => [id, 0]));
  const jitter = new Map<number, number>(topics.map((t) => [t.assignmentId, random()]));
  const order = [...topics].sort(
    (a, b) => b.loadPerChecker - a.loadPerChecker || jitter.get(a.assignmentId)! - jitter.get(b.assignmentId)!,
  );

  const slots: { assignmentId: number; checkerIds: [string, string] }[] = [];
  for (const topic of order) {
    const eligible = annotatorIds.filter((id) => {
      const mine = written.get(id);
      return !mine || !topic.subtypeIds.some((s) => mine.has(s));
    });
    if (eligible.length < 2) {
      return {
        ok: false,
        assignmentId: topic.assignmentId,
        error: `Only ${eligible.length} annotator${eligible.length === 1 ? "" : "s"} didn't write in this topic; it needs two checkers.`,
      };
    }
    const tie = new Map(eligible.map((id) => [id, random()]));
    const [first, second] = eligible.sort((a, b) => load.get(a)! - load.get(b)! || tie.get(a)! - tie.get(b)!);
    load.set(first, load.get(first)! + topic.loadPerChecker);
    load.set(second, load.get(second)! + topic.loadPerChecker);
    slots.push({ assignmentId: topic.assignmentId, checkerIds: [first, second] });
  }
  return { ok: true, slots };
}
