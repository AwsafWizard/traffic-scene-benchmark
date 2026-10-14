import { notFound } from "next/navigation";
import { requireAnnotator } from "@/server/auth";
import { getTask, myQueue } from "@/server/checks";
import { imageSrc } from "@/server/storage";
import { VBadge } from "../../ui/components";
import ZoomImage from "../../ui/ZoomImage";
import CheckTask from "./CheckTask";

export default async function CheckTaskPage({ params }: PageProps<"/check/[id]">) {
  const user = await requireAnnotator();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const task = await getTask(user.id, id);
  if (!task) notFound();
  const { todo, done } = await myQueue(user.id);
  const { image, ...view } = task;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <ZoomImage src={imageSrc(image)} alt="Traffic scene" />
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-2">
            <VBadge v={task.verifiability} long /> {task.subtype}
          </span>
          <span>
            {done} done · {todo.length} to go
          </span>
        </div>
        <CheckTask task={view} />
      </div>
    </div>
  );
}
