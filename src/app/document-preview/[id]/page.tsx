"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Download, FileText, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export default function DocumentPreviewPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { firebaseUser, loading: authLoading } = useAuth();
  const [pdfUrl, setPdfUrl] = useState("");
  const [error, setError] = useState("");
  const name = searchParams.get("name")?.trim() || "Prévia do documento";

  useEffect(() => {
    if (authLoading) return;
    if (!firebaseUser) {
      setError("Sua sessão expirou. Feche esta aba, autentique-se novamente e tente abrir a prévia.");
      return;
    }
    let active = true;
    let objectUrl = "";
    void (async () => {
      try {
        const sourceUrl = `/api/documents/templates/${encodeURIComponent(params.id)}/preview`;
        const requestPreview = (idToken: string) => fetch(sourceUrl, {
          headers: { Authorization: `Bearer ${idToken}` },
          cache: "no-store",
        });
        let response = await requestPreview(await firebaseUser.getIdToken());
        if (response.status === 401 || response.status === 403) {
          response = await requestPreview(await firebaseUser.getIdToken(true));
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Não foi possível gerar a prévia.");
        }
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setPdfUrl(objectUrl);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Não foi possível abrir a prévia.");
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authLoading, firebaseUser, params.id]);

  function downloadPdf() {
    if (!pdfUrl) return;
    const anchor = document.createElement("a");
    anchor.href = pdfUrl;
    anchor.download = `${name}.pdf`;
    anchor.click();
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-100 text-slate-950">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-white px-4 shadow-sm">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-black">{name}</h1>
          <p className="text-[11px] font-semibold text-violet-700">
            Demonstração com dados fictícios · sem validade
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" disabled={!pdfUrl} onClick={downloadPdf}>
          <Download className="h-4 w-4" />Baixar PDF
        </Button>
        <Button variant="ghost" size="icon" aria-label="Fechar visualização" onClick={() => window.close()}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <section className="min-h-0 flex-1">
        {error ? (
          <div className="grid h-[calc(100vh-4rem)] place-items-center p-6">
            <div className="max-w-lg rounded-2xl border border-rose-200 bg-white p-7 text-center shadow-sm">
              <p className="text-base font-black text-rose-900">Não foi possível abrir a prévia</p>
              <p className="mt-2 text-sm leading-relaxed text-rose-700">{error}</p>
              <Button variant="outline" className="mt-5" onClick={() => window.close()}>Fechar aba</Button>
            </div>
          </div>
        ) : !pdfUrl ? (
          <div className="grid h-[calc(100vh-4rem)] place-items-center text-center text-slate-500">
            <div>
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-violet-700" />
              <p className="mt-3 text-sm font-bold text-slate-700">Preparando a visualização…</p>
              <p className="mt-1 text-xs">Documentos maiores podem levar alguns segundos.</p>
            </div>
          </div>
        ) : (
          <iframe className="h-[calc(100vh-4rem)] w-full border-0" src={`${pdfUrl}#view=FitH`} title={name} />
        )}
      </section>
    </main>
  );
}
