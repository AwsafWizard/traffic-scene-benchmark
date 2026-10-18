import Link from "next/link";
import { requireAnnotator } from "@/server/auth";
import { listMyImages, myTopics } from "@/server/questions";
import { imageSrc } from "@/server/storage";
import { getTagGroups } from "@/server/taxonomy";
import { hfConfigured } from "@/server/hf";
import { listVideos, myFrameCounts } from "@/server/videos";
import { Notice, PageHeader } from "../ui/components";
import QuestionForm, { type FormImage, type FormTopic } from "./QuestionForm";

export default async function WritePage({ searchParams }: PageProps<"/write">) {
  const user = await requireAnnotator();
  const { topic } = await searchParams;
  const { sprint, topics: all } = await myTopics(user.id);
  // A topic whose subtypes were all hidden or deleted has nothing left to write in.
  const topics = all.filter((t) => t.subtypes.length > 0);

  if (sprint?.status !== "writing") {
    return (
      <>
        <PageHeader title="Write a question" />
        <Notice>Writing is closed right now. <Link href="/" className="underline">Back home</Link></Notice>
      </>
    );
  }
  if (topics.length === 0) {
    return (
      <>
        <PageHeader title="Write a question" />
        <Notice>You don&apos;t have a topic in this sprint yet.</Notice>
      </>
    );
  }

  const formTopics: FormTopic[] = topics.map((t) => ({
    assignmentId: t.id,
    label: t.subtype_id ? `${t.subtype_code} ${t.subtype_name}` : `${t.category_code}. ${t.category_name} (whole type)`,
    written: t.written,
    target: t.target,
    subtypes: t.subtypes,
  }));
  const images: FormImage[] = (await listMyImages(user.id)).map((i) => ({
    id: i.id,
    src: imageSrc(i, 900),
    tagIds: i.tag_ids,
    sourceVideo: i.source_video,
    sourceTime: i.source_time,
  }));
  const [library, myFrames] = await Promise.all([listVideos({ activeOnly: true }), myFrameCounts(user.id)]);
  const videos = library.map((v) => ({ id: v.id, repo: v.repo, path: v.path, name: v.name, folder: v.folder, frames: myFrames.get(v.id) ?? 0 }));
  const tagGroups = (await getTagGroups({ activeOnly: true })).map((g) => ({
    id: g.id,
    name: g.name,
    required: g.required,
    tags: g.tags.map((t) => ({ id: t.id, name: t.name })),
  }));
  const selected = formTopics.find((t) => String(t.assignmentId) === topic) ?? formTopics[0];

  return (
    <>
      <PageHeader
        title="Write a question"
        sub="Pick the subtype, choose or upload the image, then write a multiple-choice question and mark the correct option."
      />
      <QuestionForm
        mode="create"
        topics={formTopics}
        images={images}
        tagGroups={tagGroups}
        videosEnabled={hfConfigured()}
        videos={videos}
        initial={{ assignmentId: selected.assignmentId, subtypeId: selected.subtypes[0]?.id ?? 0 }}
      />
    </>
  );
}
