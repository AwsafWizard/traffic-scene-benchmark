"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  createQuestionAction,
  getUploadTicketAction,
  registerUploadAction,
  saveImageTagsAction,
  updateQuestionAction,
} from "../actions/annotator";
import { VBadge } from "../ui/components";
import { button, buttonSecondary, card, hint, input, label, select } from "../ui/styles";

export interface FormTopic {
  assignmentId: number;
  label: string;
  written: number;
  target: number;
  subtypes: { id: number; code: string; name: string; verifiability: string }[];
}

export interface FormImage {
  id: string;
  src: string;
  tagIds: number[];
}

interface TagGroupView {
  id: number;
  name: string;
  required: boolean;
  tags: { id: number; name: string }[];
}

interface Initial {
  assignmentId: number;
  subtypeId: number;
  imageId?: string;
  prompt?: string;
  options?: string[];
  correctIndex?: number;
  questionId?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 4096;

/**
 * Re-encodes an image as WebP at full resolution (quality 0.9) before upload.
 * That's about 7× smaller than the PNG frames we tested, with no visible loss.
 * Falls back to JPEG where a browser can't write WebP, and keeps the original
 * if re-encoding wouldn't make it smaller.
 */
async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  let blob = await encode("image/webp");
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg");
  if (!blob) return file;
  return blob.size < file.size || scale < 1 ? blob : file;
}

export default function QuestionForm({
  mode,
  topics,
  images: initialImages,
  tagGroups,
  initial,
}: {
  mode: "create" | "edit";
  topics: FormTopic[];
  images: FormImage[];
  tagGroups: TagGroupView[];
  initial: Initial;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [assignmentId, setAssignmentId] = useState(initial.assignmentId);
  const [subtypeId, setSubtypeId] = useState(initial.subtypeId);
  const [images, setImages] = useState(initialImages);
  const [imageId, setImageId] = useState<string | null>(initial.imageId ?? null);
  const [prompt, setPrompt] = useState(initial.prompt ?? "");
  const [options, setOptions] = useState<string[]>(initial.options ?? ["", ""]);
  const [correct, setCorrect] = useState<number>(initial.correctIndex ?? -1);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showAllImages, setShowAllImages] = useState(false);

  const topic = topics.find((t) => t.assignmentId === assignmentId) ?? topics[0];
  const subtype = topic.subtypes.find((s) => s.id === subtypeId);
  const image = images.find((i) => i.id === imageId) ?? null;
  const missingTags = useMemo(() => {
    if (!image) return [];
    return tagGroups.filter((g) => g.required && !g.tags.some((t) => image.tagIds.includes(t.id))).map((g) => g.name);
  }, [image, tagGroups]);

  async function upload(file: File) {
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a JPG, PNG or WebP image.");
      return;
    }
    setUploading(true);
    try {
      const blob = await compress(file);
      if (blob.size > MAX_BYTES) throw new Error("That image is over 10 MB even after compression.");
      const ticket = await getUploadTicketAction();
      if ("error" in ticket) throw new Error(ticket.error);

      const form = new FormData();
      for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value);
      const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
      form.append("file", new File([blob], `scene.${ext}`, { type: blob.type }));
      const response = await fetch(ticket.url, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? body?.error ?? "Upload failed.");

      let added: FormImage;
      if (ticket.mode === "local") {
        added = { id: body.id, src: `/api/local-images/${body.id}`, tagIds: [] };
      } else {
        const registered = await registerUploadAction({
          public_id: body.public_id,
          version: body.version,
          signature: body.signature,
          width: body.width,
          height: body.height,
          bytes: body.bytes,
          format: body.format,
        });
        if ("error" in registered) throw new Error(registered.error);
        added = { id: registered.id, src: registered.src, tagIds: [] };
      }
      setImages((list) => [added, ...list]);
      setImageId(added.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function toggleTag(tagId: number) {
    if (!image) return;
    const tagIds = image.tagIds.includes(tagId) ? image.tagIds.filter((t) => t !== tagId) : [...image.tagIds, tagId];
    setImages((list) => list.map((i) => (i.id === image.id ? { ...i, tagIds } : i)));
    await saveImageTagsAction(image.id, tagIds);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(null);
    if (!imageId) return setError("Choose or upload the image first.");
    if (missingTags.length) return setError(`Tag the image first: ${missingTags.join(", ")}.`);
    setSaving(true);
    const payload = { subtypeId, imageId, prompt, options, correctIndex: correct };
    const result =
      mode === "create"
        ? await createQuestionAction(assignmentId, payload)
        : await updateQuestionAction(initial.questionId!, payload);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    if (mode === "edit") {
      setSaved("Changes saved.");
      router.refresh();
      return;
    }
    setSaved("Saved. Write the next one — the same image and subtype are still selected.");
    setPrompt("");
    setOptions(["", ""]);
    setCorrect(-1);
    router.refresh();
  }

  const visibleImages = showAllImages ? images : images.slice(0, 11);

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className={`${card} space-y-4 p-5`}>
          {mode === "create" && topics.length > 1 && (
            <div>
              <label className={label} htmlFor="topic">Topic</label>
              <select
                id="topic"
                className={select}
                value={assignmentId}
                onChange={(e) => {
                  const next = topics.find((t) => t.assignmentId === Number(e.target.value))!;
                  setAssignmentId(next.assignmentId);
                  setSubtypeId(next.subtypes[0]?.id ?? 0);
                }}
              >
                {topics.map((t) => (
                  <option key={t.assignmentId} value={t.assignmentId}>
                    {t.label} — {t.written}/{t.target}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={label} htmlFor="subtype">Subtype</label>
            <select id="subtype" className={select} value={subtypeId} onChange={(e) => setSubtypeId(Number(e.target.value))}>
              {topic.subtypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.name}
                </option>
              ))}
            </select>
            {subtype && (
              <p className={`${hint} flex items-center gap-2`}>
                <VBadge v={subtype.verifiability} long />
                {subtype.verifiability === "V" && "One other annotator will check it."}
                {subtype.verifiability === "C" && "Two other annotators will answer it blind; all three must agree."}
                {subtype.verifiability === "I" && "Two other annotators will judge whether your answer is reasonable."}
              </p>
            )}
          </div>
        </section>

        <section className={`${card} space-y-4 p-5`}>
          <div>
            <label className={label} htmlFor="prompt">Question</label>
            <textarea
              id="prompt"
              rows={3}
              className={input}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. How many rickshaws are waiting at the stop line?"
            />
          </div>
          <div className="space-y-2">
            <span className={label}>Options — mark the correct one</span>
            {options.map((option, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="correct"
                  aria-label={`Option ${i + 1} is correct`}
                  checked={correct === i}
                  onChange={() => setCorrect(i)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <input
                  className={input}
                  value={option}
                  placeholder={`Option ${i + 1}`}
                  onChange={(e) => setOptions((list) => list.map((o, j) => (j === i ? e.target.value : o)))}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    className="px-2 text-muted hover:text-foreground"
                    aria-label={`Remove option ${i + 1}`}
                    onClick={() => {
                      setOptions((list) => list.filter((_, j) => j !== i));
                      setCorrect((c) => (c === i ? -1 : c > i ? c - 1 : c));
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {options.length < 5 && (
              <button type="button" className={buttonSecondary} onClick={() => setOptions((list) => [...list, ""])}>
                Add option
              </button>
            )}
            <p className={hint}>
              2–5 options. Yes/no questions are just two options. Checkers see the options in a shuffled order.
            </p>
          </div>
        </section>

        {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {saved && <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{saved}</p>}
        <button type="submit" disabled={saving || uploading} className={button}>
          {saving ? "Saving…" : mode === "create" ? "Save question" : "Save changes"}
        </button>
      </div>

      <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section className={`${card} space-y-3 p-5`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Image</span>
            <button type="button" className={buttonSecondary} disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? "Uploading…" : "Upload new"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </div>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.src} alt="Selected scene" className="w-full rounded-lg border border-line object-contain" />
          ) : (
            <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
              Upload a scene, or pick one you uploaded before.
            </p>
          )}

          {image && (
            <div className="space-y-2">
              {tagGroups.map((g) => (
                <div key={g.id}>
                  <div className="text-xs font-medium">
                    {g.name}
                    {g.required && <span className="text-red-500"> *</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {g.tags.map((t) => {
                      const on = image.tagIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleTag(t.id)}
                          className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                            on ? "border-accent bg-accent text-white" : "border-line hover:bg-background"
                          }`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {missingTags.length > 0 && <p className="text-xs text-amber-600">Still needed: {missingTags.join(", ")}</p>}
            </div>
          )}

          {images.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs text-muted">Your images</div>
              <div className="grid grid-cols-4 gap-1.5">
                {visibleImages.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setImageId(i.id)}
                    className={`overflow-hidden rounded border-2 ${i.id === imageId ? "border-accent" : "border-transparent"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={i.src} alt="" className="h-14 w-full object-cover" />
                  </button>
                ))}
                {images.length > 11 && !showAllImages && (
                  <button type="button" className="rounded border border-line text-xs text-muted" onClick={() => setShowAllImages(true)}>
                    +{images.length - 11} more
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </form>
  );
}
