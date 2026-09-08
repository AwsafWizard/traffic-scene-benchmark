import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadPath } from "@/lib/db";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  // Reject anything that isn't a bare filename so a crafted name can't escape the uploads directory.
  if (name !== path.basename(name)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const type = TYPES[path.extname(name).toLowerCase()];
  if (!type) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  try {
    const bytes = await fs.readFile(uploadPath(name));
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
