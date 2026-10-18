import "server-only";

/**
 * Videos in a private Hugging Face dataset repo, read with HF_TOKEN (a
 * fine-grained token with read access to that repo only).
 *
 * The token never reaches a browser. To play a video we ask Hugging Face for
 * the file and keep the redirect it answers with: a signed CDN link to that one
 * file, valid for about an hour. The CDN serves it with CORS headers and byte
 * ranges, so the setter's browser can seek and read frames off it.
 */

const HUB = "https://huggingface.co";
export const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv"];

export function hfConfigured(): boolean {
  return Boolean(process.env.HF_TOKEN);
}

function headers(): HeadersInit {
  return { Authorization: `Bearer ${process.env.HF_TOKEN}` };
}

/**
 * The "owner/name" of a dataset repo, from that or from any link into it
 * (https://huggingface.co/datasets/owner/name/tree/main/…).
 */
export function parseRepo(input: string): string | null {
  const text = input.trim().replace(/\/+$/, "");
  const link = text.match(/huggingface\.co\/datasets\/([\w.-]+\/[\w.-]+)/);
  const repo = link ? link[1] : text;
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

function hubError(status: number): string {
  if (status === 401 || status === 403 || status === 404) {
    return "Hugging Face can't find that repo, or the app's token can't read it. Check the name, and that HF_TOKEN has read access to it.";
  }
  if (status === 429) return "Hugging Face is rate-limiting us. Try again in a few minutes.";
  return `Hugging Face answered ${status}.`;
}

export interface RepoVideo {
  path: string;
  size: number | null;
}

/** Every video file in the repo, subfolders included. */
export async function listRepoVideos(repo: string): Promise<RepoVideo[]> {
  const found: RepoVideo[] = [];
  let url: string | null = `${HUB}/api/datasets/${repo}/tree/main?recursive=true`;
  while (url) {
    const response: Response = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!response.ok) throw new Error(hubError(response.status));
    const items = (await response.json()) as { type: string; path: string; size?: number; lfs?: { size?: number } }[];
    for (const item of items) {
      const ext = item.path.split(".").pop()?.toLowerCase() ?? "";
      if (item.type === "file" && VIDEO_EXTENSIONS.includes(ext)) {
        found.push({ path: item.path, size: item.lfs?.size ?? item.size ?? null });
      }
    }
    url = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return found.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

const links = new Map<string, { url: string; expiresAt: number }>();

/** A signed CDN link that plays one video, and when it stops working (ms since epoch). */
export async function videoLink(repo: string, path: string): Promise<{ url: string; expiresAt: number }> {
  const key = `${repo}/${path}`;
  const cached = links.get(key);
  if (cached && cached.expiresAt - Date.now() > 15 * 60_000) return cached;

  const response = await fetch(`${HUB}/datasets/${repo}/resolve/main/${encodePath(path)}`, {
    headers: headers(),
    redirect: "manual",
    cache: "no-store",
  });
  const location = response.headers.get("location");
  if (response.status < 300 || response.status >= 400 || !location) {
    if (response.ok) throw new Error("That file isn't stored as a large file on Hugging Face, so it can't be streamed.");
    throw new Error(hubError(response.status));
  }
  const url = new URL(location, HUB).toString();
  // CloudFront links say when they expire; S3-style ones give a lifetime. Assume an hour otherwise.
  const params = new URL(url).searchParams;
  const now = Date.now();
  const expires = Number(params.get("Expires"));
  const lifetime = Number(params.get("X-Amz-Expires"));
  const stated = expires > 0 ? expires * 1000 : lifetime > 0 ? now + lifetime * 1000 : Infinity;
  const expiresAt = Math.min(stated, now + 60 * 60_000);
  const link = { url, expiresAt };
  links.set(key, link);
  return link;
}
