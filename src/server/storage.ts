import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { sql } from "./db";

/**
 * Scene images. In production they live on Cloudinary as "authenticated" assets:
 * nothing is reachable without a URL our server signed, and only signed-in users
 * with a reason to see an image are handed one. Browsers upload straight to
 * Cloudinary with a short-lived signature from us, because Vercel functions
 * reject request bodies over 4.5 MB.
 *
 * Without Cloudinary keys (local development) images go to .uploads/ instead and
 * are served by our own route, which checks the session.
 */

export interface StoredImage {
  id: string;
  storage: "cloudinary" | "local";
  storage_key: string;
  version: string | null;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_FORMATS = ["jpg", "jpeg", "png", "webp"];
const FOLDER = "dhakavqa";

function cloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET,
  );
}

export function storageMode(): "cloudinary" | "local" {
  if (cloudinaryConfigured()) return "cloudinary";
  if (process.env.VERCEL) throw new Error("Cloudinary is not configured: set CLOUDINARY_CLOUD_NAME, _API_KEY and _API_SECRET.");
  return "local";
}

function configure() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export type UploadTicket =
  | { mode: "cloudinary"; url: string; fields: Record<string, string> }
  | { mode: "local"; url: string; fields: Record<string, string> };

/** What the browser needs to upload one image. Each ticket names its own public id. */
export function uploadTicket(userId: string): UploadTicket {
  if (storageMode() === "local") return { mode: "local", url: "/api/local-images", fields: {} };
  configure();
  const params = {
    allowed_formats: ALLOWED_FORMATS.join(","),
    public_id: `${FOLDER}/${userId}/${crypto.randomUUID()}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: "authenticated",
  };
  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET!);
  return {
    mode: "cloudinary",
    url: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    fields: { ...params, api_key: process.env.CLOUDINARY_API_KEY!, signature },
  };
}

/** The library video a captured frame came from: its repo, its path there, and the second. Manual uploads have none. */
export interface VideoSource {
  repo: string;
  video: string;
  time: number;
}

/** Keeps only well-formed values: this comes from the browser. */
export function cleanVideoSource(raw: unknown): VideoSource | null {
  if (!raw || typeof raw !== "object") return null;
  const { repo, video, time } = raw as Record<string, unknown>;
  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  if (typeof video !== "string" || !video.trim() || video.length > 500) return null;
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0) return null;
  return { repo, video, time: Math.round(time * 1000) / 1000 };
}

export interface CloudinaryUploadResult {
  public_id: string;
  version: number | string;
  signature: string;
  width?: number;
  height?: number;
  bytes?: number;
  format?: string;
}

/**
 * Records an image the browser says it uploaded. Cloudinary signs its upload
 * response with our secret, so a forged or altered result is rejected, and the
 * public id has to sit in the uploader's own folder.
 */
export async function registerCloudinaryUpload(
  userId: string,
  result: CloudinaryUploadResult,
  source: VideoSource | null = null,
): Promise<string> {
  configure();
  const version = String(result.version);
  if (!result.public_id.startsWith(`${FOLDER}/${userId}/`)) throw new Error("That upload doesn't belong to you.");
  const expected = cloudinary.utils.api_sign_request({ public_id: result.public_id, version }, process.env.CLOUDINARY_API_SECRET!);
  const given = Buffer.from(String(result.signature));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, Buffer.from(expected))) {
    throw new Error("Upload signature didn't verify.");
  }
  const [row] = await sql<{ id: string }[]>`
    insert into images (uploader_id, storage, storage_key, version, format, width, height, bytes,
                        source_repo, source_video, source_time)
    values (${userId}, 'cloudinary', ${result.public_id}, ${version}, ${result.format ?? null},
            ${result.width ?? null}, ${result.height ?? null}, ${result.bytes ?? null},
            ${source?.repo ?? null}, ${source?.video ?? null}, ${source?.time ?? null})
    returning id`;
  return row.id;
}

// Local development storage ------------------------------------------------------------

const LOCAL_DIR = path.join(process.cwd(), ".uploads");
const LOCAL_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function saveLocalImage(userId: string, file: File, source: VideoSource | null = null): Promise<string> {
  if (storageMode() !== "local") throw new Error("Local storage is only for development.");
  const ext = LOCAL_TYPES[file.type];
  if (!ext) throw new Error("Use a JPG, PNG or WebP image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images must be 10 MB or smaller.");
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(LOCAL_DIR, name), Buffer.from(await file.arrayBuffer()));
  const [row] = await sql<{ id: string }[]>`
    insert into images (uploader_id, storage, storage_key, format, bytes, source_repo, source_video, source_time)
    values (${userId}, 'local', ${name}, ${ext}, ${file.size},
            ${source?.repo ?? null}, ${source?.video ?? null}, ${source?.time ?? null}) returning id`;
  return row.id;
}

export async function readLocalImage(name: string): Promise<{ data: Buffer; type: string }> {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) throw new Error("Bad image name");
  const data = await fs.readFile(path.join(LOCAL_DIR, name));
  const ext = name.split(".").pop()!;
  return { data, type: ext === "jpg" ? "image/jpeg" : `image/${ext}` };
}

// Showing images -----------------------------------------------------------------------

/** A URL to display an image. Only call it for someone allowed to see the image. */
export function imageSrc(image: StoredImage, width?: number): string {
  if (image.storage === "local") return `/api/local-images/${image.id}`;
  configure();
  return cloudinary.url(image.storage_key, {
    type: "authenticated",
    sign_url: true,
    secure: true,
    version: image.version ?? undefined,
    transformation: [{ quality: "auto", fetch_format: "auto", ...(width ? { width, crop: "limit" } : {}) }],
  });
}

/** The image bytes, for sending to a model API. Capped at 1600 px to keep requests small. */
export async function imageBytes(image: StoredImage): Promise<{ data: Buffer; type: string }> {
  if (image.storage === "local") return readLocalImage(image.storage_key);
  configure();
  const url = cloudinary.url(image.storage_key, {
    type: "authenticated",
    sign_url: true,
    secure: true,
    version: image.version ?? undefined,
    transformation: [{ width: 1600, crop: "limit", quality: 90, fetch_format: "jpg" }],
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't fetch the image (${response.status}).`);
  return { data: Buffer.from(await response.arrayBuffer()), type: "image/jpeg" };
}

/**
 * Who may see an image: the admin, its uploader, and anyone with a check on a
 * question that uses it.
 */
export async function canViewImage(user: { id: string; role: string }, imageId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const [row] = await sql`
    select 1 from images i where i.id = ${imageId} and (
      i.uploader_id = ${user.id}
      or exists (select 1 from questions q join checks c on c.question_id = q.id
                 where q.image_id = i.id and c.checker_id = ${user.id}))`;
  return Boolean(row);
}
