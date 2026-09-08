import { NextResponse } from "next/server";
import { exportQuestions, exportResponses } from "@/lib/bundle";
import { isGrounder } from "@/lib/session";

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") ?? "questions";
  const grounder = await isGrounder();

  // A grounder has no reference answers to leak, but exporting the question set
  // isn't their job either — they send answers back.
  if (grounder && kind !== "responses") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  let body: unknown;
  let filename: string;

  if (kind === "questions") {
    body = exportQuestions();
    filename = `traffic-bench-questions-${stamp}.json`;
  } else if (kind === "responses") {
    body = exportResponses();
    filename = `traffic-bench-answers-${stamp}.json`;
  } else {
    return NextResponse.json({ error: "Unknown export kind" }, { status: 400 });
  }

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
