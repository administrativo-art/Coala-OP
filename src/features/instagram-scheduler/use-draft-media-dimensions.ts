"use client";

import { useEffect, useState } from "react";
import type { MediaDimensions } from "./media-presentation";

/** Local object URLs only. Never uploads or persists client-supplied dimensions. */
export function useDraftMediaDimensions(files: readonly File[], urls: readonly string[]) {
  const [dimensions, setDimensions] = useState<Record<string, MediaDimensions>>({});
  useEffect(() => {
    let active = true;
    setDimensions({});
    const cleanup = files.map((file, index) => {
      const url = urls[index];
      if (!url) return () => {};
      const report = (width: number, height: number) => {
        if (active && width > 0 && height > 0) setDimensions((current) => ({ ...current, [url]: { width, height } }));
      };
      if (file.type.startsWith("video/")) {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => report(video.videoWidth, video.videoHeight);
        video.src = url;
        return () => { video.onloadedmetadata = null; video.removeAttribute("src"); video.load(); };
      }
      const image = new Image();
      image.onload = () => report(image.naturalWidth, image.naturalHeight);
      image.src = url;
      return () => { image.onload = null; image.src = ""; };
    });
    return () => { active = false; cleanup.forEach((dispose) => dispose()); };
  }, [files, urls]);
  return urls.map((url) => dimensions[url] ?? {});
}
