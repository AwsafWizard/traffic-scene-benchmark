import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { saveLocalImage, storageMode } from "@/server/storage";

/** Development-only upload endpoint, used when Cloudinary isn't configured. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "annotator") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (storageMode() !== "local") return NextResponse.json({ error: "Uploads go to Cloudinary" }, { status: 400 });

  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  try {
    return NextResponse.json({ id: await saveLocalImage(user.id, file) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
