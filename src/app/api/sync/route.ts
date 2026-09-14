import { NextResponse } from "next/server";
import { SyncError, getSyncConfig, setSyncConfig, syncNow, type SyncMode } from "@/lib/sync";

export const maxDuration = 120;

export async function GET() {
  return NextResponse.json(getSyncConfig());
}

/** Runs a sync now. */
export async function POST() {
  try {
    return NextResponse.json(await syncNow());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: error instanceof SyncError ? 400 : 500 });
  }
}

/** Updates the folder and on/off switch. */
export async function PUT(request: Request) {
  const body = (await request.json()) as { dir?: string; mode?: SyncMode };
  try {
    return NextResponse.json(setSyncConfig(body.mode ?? "off", body.dir ?? null));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save";
    return NextResponse.json({ error: message }, { status: error instanceof SyncError ? 400 : 500 });
  }
}
