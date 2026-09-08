import { NextResponse } from "next/server";
import {
  BundleError,
  importQuestions,
  importResponses,
  parseBundle,
  type QuestionBundle,
  type ResponseBundle,
} from "@/lib/bundle";
import { isGrounder } from "@/lib/session";

export const maxDuration = 120;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("bundle");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a bundle file first" }, { status: 400 });
  }

  try {
    const bundle = parseBundle(await file.text());

    // The grounder imports the question set; only the benchmarker merges answers back.
    if (bundle.kind === "responses" && (await isGrounder())) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const result =
      bundle.kind === "questions"
        ? importQuestions(bundle as QuestionBundle)
        : importResponses(bundle as ResponseBundle);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BundleError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 },
    );
  }
}
