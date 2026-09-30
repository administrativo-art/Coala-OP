"use client";

import { useEffect, useRef, useState } from "react";
import { Film, ImageIcon, Loader2 } from "lucide-react";

import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";

type ProtectedMediaProps = {
  url: string | null;
  alt: string;
  kind?: "image" | "video";
  className?: string;
  eager?: boolean;
};

export function ProtectedMedia({
  url,
  alt,
  kind = "image",
  className = "h-full w-full object-cover",
  eager = false,
}: ProtectedMediaProps) {
  const request = useAuthenticatedApi();
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible || !url || !hostRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "180px" },
    );
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [url, visible]);

  useEffect(() => {
    setSource(null);
    setFailed(false);
    if (!visible || !url || kind === "video") return;
    let active = true;
    let objectUrl: string | null = null;
    void request<Blob>(url, {
      responseType: "blob",
      fallbackError: "Não foi possível carregar a prévia.",
    })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, request, url, visible]);

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden bg-[#F3E8DC]">
      {source ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt={alt} className={className} />
      ) : (
        <div className="flex h-full min-h-16 w-full items-center justify-center bg-[repeating-linear-gradient(135deg,#F3E8DC_0_7px,#fff_7px_14px)] text-[#7A5646]">
          {kind === "video" ? (
            <Film className="h-6 w-6" aria-hidden="true" />
          ) : failed ? (
            <ImageIcon className="h-6 w-6" aria-hidden="true" />
          ) : visible && url ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Carregando prévia" />
          ) : (
            <ImageIcon className="h-6 w-6" aria-hidden="true" />
          )}
        </div>
      )}
    </div>
  );
}
