"use client";

import { useState } from "react";

/** A scene image that switches between fitting the column and full size, for reading small details. */
export default function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className="space-y-1">
      <div className={`overflow-auto rounded-xl border border-line bg-surface ${zoomed ? "max-h-[80vh]" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onClick={() => setZoomed((z) => !z)}
          className={zoomed ? "max-w-none cursor-zoom-out" : "w-full cursor-zoom-in object-contain"}
        />
      </div>
      <p className="text-xs text-muted">{zoomed ? "Scroll to look around. Click to fit." : "Click the image to see it full size."}</p>
    </div>
  );
}
