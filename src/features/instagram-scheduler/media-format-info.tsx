import type { InstagramPublicationFormat } from "./contracts";
import { mediaCompatibility, mediaDimensionsLabel, type PresentationMedia } from "./media-presentation";

export function MediaFormatInfo({ format, media }: { format: InstagramPublicationFormat; media?: PresentationMedia | null }) {
  const compatibility = mediaCompatibility(format, media);
  return (
    <div className="mt-2 space-y-1 text-[11px] leading-4" aria-live="polite">
      <p className="text-[#7A5646]">{mediaDimensionsLabel(media)}</p>
      <p className={compatibility.status === "compatible" ? "text-[#217052]" : compatibility.status === "invalid" ? "text-[#A52E24]" : "text-[#8A5A18]"}>
        {compatibility.message}
      </p>
    </div>
  );
}
