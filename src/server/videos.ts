import "server-only";
import { audit } from "./audit";
import { sql } from "./db";

/**
 * The video library. Videos stay in a Hugging Face dataset repo (see hf.ts);
 * we keep only which files they are and whether setters may use them.
 */

export interface Video {
  id: number;
  repo: string;
  path: string;
  /** The file name, and the folders above it inside the repo (null at the top). */
  name: string;
  folder: string | null;
  size_bytes: number | null;
  active: boolean;
  created_at: Date;
  /** Frames captured from it so far, by everyone. */
  frames: number;
}

/** Splits "mirpur/day/VID.mp4" into its folder "mirpur / day" and name "VID.mp4". */
export function splitPath(path: string): { folder: string | null; name: string } {
  const parts = path.split("/");
  const name = parts.pop()!;
  return { folder: parts.length ? parts.join(" / ") : null, name };
}

type Row = Omit<Video, "name" | "folder">;
const withNames = (rows: Row[]): Video[] => rows.map((r) => ({ ...r, ...splitPath(r.path) }));

export async function listVideos({ activeOnly = false } = {}): Promise<Video[]> {
  const rows = await sql<Row[]>`
    select v.id, v.repo, v.path, v.size_bytes::float8 as size_bytes, v.active, v.created_at,
      (select count(*)::int from images i where i.source_repo = v.repo and i.source_video = v.path) as frames
    from videos v
    where ${activeOnly ? sql`v.active` : sql`true`}
    order by v.repo, v.path`;
  return withNames(rows);
}

export async function getVideo(id: number): Promise<Video | null> {
  const [row] = await sql<Row[]>`
    select id, repo, path, size_bytes::float8 as size_bytes, active, created_at, 0 as frames from videos where id = ${id}`;
  return row ? withNames([row])[0] : null;
}

/** How many frames one setter has captured from each video, by video id. */
export async function myFrameCounts(userId: string): Promise<Map<number, number>> {
  const rows = await sql<{ id: number; frames: number }[]>`
    select v.id, count(*)::int as frames from images i
    join videos v on v.repo = i.source_repo and v.path = i.source_video
    where i.uploader_id = ${userId} group by v.id`;
  return new Map(rows.map((r) => [r.id, r.frames]));
}

/** Adds videos from a repo. Ones already in the library are left as they are. Returns how many were new. */
export async function addVideos(actorId: string, repo: string, files: { path: string; size: number | null }[]): Promise<number> {
  if (files.length === 0) return 0;
  const rows = files.map((f) => ({ repo, path: f.path, size_bytes: f.size, added_by: actorId }));
  const added = await sql`
    insert into videos ${sql(rows, "repo", "path", "size_bytes", "added_by")}
    on conflict (repo, path) do nothing returning id`;
  await audit(actorId, "videos.add", repo, { offered: files.length, added: added.length });
  return added.length;
}

export async function setVideoActive(actorId: string, id: number, active: boolean): Promise<void> {
  await sql`update videos set active = ${active} where id = ${id}`;
  await audit(actorId, active ? "video.show" : "video.hide", id);
}

/** Turns on or off every video in one folder of a repo ("" is the repo's top level). */
export async function setFolderActive(actorId: string, repo: string, folder: string, active: boolean): Promise<void> {
  const prefix = folder ? `${folder.split(" / ").join("/")}/` : "";
  await sql`
    update videos set active = ${active}
    where repo = ${repo} and (case when ${prefix} = '' then position('/' in path) = 0
                                   else starts_with(path, ${prefix}) and position('/' in substr(path, length(${prefix}) + 1)) = 0 end)`;
  await audit(actorId, active ? "videos.show_folder" : "videos.hide_folder", `${repo}/${prefix}`);
}

export async function deleteVideo(actorId: string, id: number): Promise<void> {
  await sql`delete from videos where id = ${id}`;
  await audit(actorId, "video.delete", id);
}
