import { requireAdmin } from "@/server/auth";
import { hfConfigured } from "@/server/hf";
import { listVideos, type Video } from "@/server/videos";
import { deleteVideoAction, setFolderActiveAction, setVideoActiveAction } from "../../actions/admin";
import { Notice, PageHeader } from "../../ui/components";
import SubmitButton from "../../ui/SubmitButton";
import { buttonDanger, buttonSecondary, card, td, th } from "../../ui/styles";
import ActionForm from "../ActionForm";
import SettingsTabs from "../SettingsTabs";
import AddVideos from "./AddVideos";

function size(bytes: number | null): string {
  if (!bytes) return "—";
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

const viewUrl = (v: Video) => `https://huggingface.co/datasets/${v.repo}/blob/main/${v.path.split("/").map(encodeURIComponent).join("/")}`;

export default async function VideosPage() {
  await requireAdmin();
  const videos = await listVideos();
  const on = videos.filter((v) => v.active).length;
  const frames = videos.reduce((sum, v) => sum + v.frames, 0);

  // One card per folder of each repo, in the order listVideos sorts them.
  const groups = new Map<string, { repo: string; folder: string | null; list: Video[] }>();
  for (const v of videos) {
    const key = `${v.repo}\n${v.folder ?? ""}`;
    if (!groups.has(key)) groups.set(key, { repo: v.repo, folder: v.folder, list: [] });
    groups.get(key)!.list.push(v);
  }
  const repos = new Set(videos.map((v) => v.repo));
  const lastRepo = [...videos].sort((a, b) => +b.created_at - +a.created_at)[0]?.repo ?? "";

  return (
    <div className="space-y-8">
      <SettingsTabs />
      <PageHeader
        title="Videos"
        sub={`${videos.length} in the library · ${on} on · ${frames} frames captured. Setters capture frames from the videos that are on.`}
      />

      {hfConfigured() ? (
        <AddVideos lastRepo={lastRepo} />
      ) : (
        <Notice tone="warn">
          Set <code>HF_TOKEN</code> on the server to add and play videos from Hugging Face. The README explains how to make one.
        </Notice>
      )}

      {[...groups.values()].map(({ repo, folder, list }) => {
        const allOn = list.every((v) => v.active);
        return (
          <section key={`${repo}/${folder ?? ""}`} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="font-medium">
                {repos.size > 1 && <span className="text-muted">{repo} · </span>}
                {folder ?? (repos.size > 1 ? "top level" : "Top level of the repo")}
              </h2>
              <form action={setFolderActiveAction}>
                <input type="hidden" name="repo" value={repo} />
                <input type="hidden" name="folder" value={folder ?? ""} />
                <input type="hidden" name="active" value={allOn ? "false" : "true"} />
                <SubmitButton className={buttonSecondary} pending="…">
                  {allOn ? "Turn all off" : "Turn all on"}
                </SubmitButton>
              </form>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Video</th>
                    <th className={th}>Size</th>
                    <th className={th}>Frames</th>
                    <th className={th}>Setters see it</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((v) => (
                    <tr key={v.id} className={v.active ? "" : "text-muted"}>
                      <td className={td}>
                        <a href={viewUrl(v)} target="_blank" rel="noreferrer" className="hover:underline">
                          {v.name}
                        </a>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{size(v.size_bytes)}</td>
                      <td className={td}>{v.frames}</td>
                      <td className={td}>
                        <form action={setVideoActiveAction} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={v.id} />
                          <input type="hidden" name="active" value={v.active ? "false" : "true"} />
                          <span className={`w-6 text-xs font-medium ${v.active ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                            {v.active ? "On" : "Off"}
                          </span>
                          <SubmitButton className={buttonSecondary} pending="…">
                            {v.active ? "Turn off" : "Turn on"}
                          </SubmitButton>
                        </form>
                      </td>
                      <td className={`${td} text-right`}>
                        <ActionForm action={deleteVideoAction}>
                          <input type="hidden" name="id" value={v.id} />
                          <SubmitButton
                            className={buttonDanger}
                            pending="…"
                            confirm={`Remove ${v.name} from the library? Frames already captured from it stay.`}
                          >
                            Remove
                          </SubmitButton>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
