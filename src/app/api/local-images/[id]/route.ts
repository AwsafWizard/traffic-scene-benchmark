import { getSessionUser } from "@/server/auth";
import { sql } from "@/server/db";
import { canViewImage, readLocalImage } from "@/server/storage";

/** Serves a locally stored image to someone allowed to see it (development only). */
export async function GET(_request: Request, { params }: RouteContext<"/api/local-images/[id]">) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !/^[0-9a-f-]{36}$/.test(id) || !(await canViewImage(user, id))) {
    return new Response("Not found", { status: 404 });
  }
  const [image] = await sql<{ storage_key: string }[]>`
    select storage_key from images where id = ${id} and storage = 'local'`;
  if (!image) return new Response("Not found", { status: 404 });
  const { data, type } = await readLocalImage(image.storage_key);
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" },
  });
}
