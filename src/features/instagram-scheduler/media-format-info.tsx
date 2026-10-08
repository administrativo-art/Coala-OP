import type { InstagramPublicationFormat } from "./contracts";
import { mediaCompatibility, mediaDimensionsLabel, type PresentationMedia } from "./media-presentation";

export function MediaFormatInfo({ format, media }: { format: InstagramPublicationFormat; media?: PresentationMedia | null }) {
  const compatibility = mediaCompatibility(format, media);
  return (
    <div className="mt-2 space-y-1 text-[11px] leading-4" aria-live="polite">
      <p className="text-ds-ink-muted">{mediaDimensionsLabel(media)}</p>
      <p className={compatibility.status === "compatible" ? "text-ds-ok" : compatibility.status === "invalid" ? "text-ds-danger" : "text-ds-warn"}>
        {compatibility.message}
      </p>
    </div>
  );
}
