"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Heart, Loader2, MapPin, MessageCircle, NotebookText, Percent, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { type BioImage, type BioLink, type BioPage, defaultBioPage, MAX_BIO_IMAGES, validateBioForPublish } from "@/lib/public-bio";

const kinds: Array<{ value: BioLink["kind"]; label: string; symbol: string }> = [
  { value: "menu", label: "Cardápio", symbol: "✦" },
  { value: "promotions", label: "Promoções", symbol: "%" },
  { value: "whatsapp", label: "WhatsApp", symbol: "↗" },
  { value: "delivery", label: "Delivery", symbol: "↗" },
  { value: "location", label: "Localização", symbol: "⌁" },
  { value: "instagram", label: "Instagram", symbol: "◎" },
  { value: "other", label: "Outro", symbol: "↗" },
];

const publicUrl = process.env.NEXT_PUBLIC_BIO_SITE_URL || "https://bio.coalashakes.com";

function BioPreview({ page, mediaUrls, gallery }: { page: BioPage; mediaUrls: Record<string, string>; gallery: "page" | "menuImages" | "promotionImages" }) {
  const visible = page.links.filter((link) => link.enabled);
  const featured = visible.filter((link) => link.placement === "featured");
  const quick = visible.filter((link) => link.placement === "quick");
  const icon = (kind: BioLink["kind"], size = 21) => {
    if (kind === "menu") return <NotebookText size={size} />;
    if (kind === "location") return <MapPin size={size} />;
    if (kind === "whatsapp") return <MessageCircle size={size} />;
    if (kind === "promotions") return <Percent size={size} />;
    return <ExternalLink size={size} />;
  };
  return (
    <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-[34px] border-[7px] border-[#252025] bg-[#fffcf6] shadow-[0_24px_60px_rgba(50,28,45,.18)]">
      <div className="mx-auto h-[14px] w-[100px] rounded-b-2xl bg-[#252025]" />
      <div className="relative overflow-hidden bg-[#fffcf6] text-center text-[#173768]">
        {gallery !== "page" ? <div className="relative min-h-[560px] px-4 pb-6 pt-8">
          <h4 className="text-2xl font-black text-[#f71979]">{gallery === "menuImages" ? "Cardápio" : "Promoções"}</h4>
          {gallery === "menuImages" ? <p className="mx-auto mt-3 max-w-[270px] rounded-xl bg-[#fff0d1] px-3 py-2 text-xs font-semibold">A disponibilidade dos produtos pode variar conforme a unidade.</p> : null}
          {page[gallery].length ? <div className="mt-5 space-y-3">{page[gallery].map((item, index) => <div key={item.id} className="overflow-hidden rounded-xl bg-white shadow-sm">
            {mediaUrls[item.id] ? <Image src={mediaUrls[item.id]} alt={item.alt} width={600} height={900} unoptimized className="h-auto w-full" /> : <div className="flex h-36 items-center justify-center text-xs">Carregando imagem…</div>}
            <p className="p-2 text-xs">{index + 1} de {page[gallery].length}</p>
          </div>)}</div> : <p className="mt-8 text-sm">Envie imagens para montar esta galeria.</p>}
        </div> : <>
        <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[#ff78ad]" />
        <div className="pointer-events-none absolute -left-20 top-44 h-44 w-32 rounded-full bg-[#03afd0]" />
        <div className="relative px-4 pt-3">
          <div className="relative mx-auto h-[148px] w-[290px]"><Image src="/images/coala-bio-logo.png" fill alt={page.title} className="object-cover" /></div>
          <p className="mt-4 text-[12px] font-bold">{page.description}</p>
          <p className="mt-2 -rotate-3 text-[31px] font-black leading-[.91] tracking-tight text-[#f71979] [font-family:cursive]">Aqui o exagero<br />é ingrediente.</p>
          <div className="mx-auto mt-2 h-1.5 w-24 -rotate-3 rounded-full bg-[#029ec5]" />
          <p className="mt-3 text-[10px]">Cardápio, unidades e contato em um só lugar.</p>
        </div>
        <Image src="/images/coala-bio-cups.png" width={320} height={213} alt="Sobremesas Coala Shakes" className="relative -mb-2 mt-2 w-full" />
        <div className="relative space-y-2 px-5">
          {featured.map((link) => <div key={link.id} className={`flex min-h-12 items-center gap-3 rounded-full px-4 text-left ${link.kind === "whatsapp" ? "bg-[#10a358] text-white" : link.kind === "location" ? "border border-[#f5dec1] bg-[#fff4e3] text-[#f71979]" : link.kind === "other" ? "border-2 border-[#f71979] bg-[#fff2f7] text-[#f71979]" : "bg-[#fa1679] text-white"}`}>
            {icon(link.kind, 20)}<strong className="min-w-0 flex-1 truncate text-[15px]">{link.label}</strong><span aria-hidden="true">›</span>
          </div>)}
        </div>
        <div className="relative mt-5 rounded-t-[45%] bg-[#fff7ed] px-4 pb-6 pt-5">
          <h4 className="-rotate-3 text-[25px] font-black text-[#f71979] [font-family:cursive]"><span className="text-[#05a5c6]">Acesse</span> rápido</h4>
          {quick.length ? <div className="mt-3 grid grid-cols-2 gap-2">{quick.map((link) => <div key={link.id} className="flex min-h-[104px] flex-col items-center rounded-xl bg-white px-2 py-3 shadow-sm">
            <span className={link.kind === "location" ? "text-[#02a7ca]" : link.kind === "whatsapp" ? "text-[#059959]" : "text-[#f71979]"}>{icon(link.kind, 24)}</span>
            <strong className="mt-1 text-[12px] leading-tight">{link.label}</strong><span className="mt-1 text-[10px] leading-tight text-[#63708b]">{link.subtitle}</span>
          </div>)}</div> : <p className="mt-3 rounded-xl bg-white p-4 text-xs">Ative um link para ver os cartões.</p>}
          <p className="mt-4 flex items-center justify-center gap-1 text-[11px] font-bold italic"><Heart size={17} className="text-[#f71979]" />Mais que sorvete, é felicidade em copo.</p>
        </div>
        <div className="flex min-h-12 items-center justify-center gap-2 bg-[#173768] px-3 text-white"><div className="relative h-10 w-[90px] overflow-hidden"><Image src="/images/coala-bio-logo.png" fill alt="Coala Shakes" className="-translate-y-1 object-cover" /></div><span className="text-[9px]">© Coala Shakes</span></div>
        </>}
      </div>
    </div>
  );
}

export function PublicBioSettings() {
  const { firebaseUser } = useAuth();
  const request = useAuthenticatedApi();
  const [draft, setDraft] = useState<BioPage>(defaultBioPage);
  const [saved, setSaved] = useState<BioPage>(defaultBioPage);
  const [revision, setRevision] = useState(0);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"save" | "publish" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<"menuImages" | "promotionImages" | null>(null);
  const [previewGallery, setPreviewGallery] = useState<"page" | "menuImages" | "promotionImages">("page");
  const mediaIds = [...draft.menuImages, ...draft.promotionImages].map((item) => item.id).sort().join(",");
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  useEffect(() => {
    QRCode.toDataURL(publicUrl, { width: 360, margin: 2, color: { dark: "#173768", light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, []);

  const copyPublicUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage({ type: "success", text: "Link da página copiado." });
    } catch {
      setMessage({ type: "error", text: "Não foi possível copiar. Selecione o endereço exibido abaixo." });
    }
  };

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const data = await request<{ draft: BioPage; revision: number; publishedAt: string | null }>("/api/settings/public-bio", { fallbackError: "Não foi possível carregar a página." });
        if (!active) return;
        setDraft(data.draft);
        setSaved(data.draft);
        setRevision(data.revision);
        setPublishedAt(data.publishedAt);
      } catch (error) {
        if (active) setMessage({ type: "error", text: error instanceof Error ? error.message : "Erro ao carregar." });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [firebaseUser, request]);

  useEffect(() => {
    if (!firebaseUser || !mediaIds) { setMediaUrls({}); return; }
    let active = true;
    const created: string[] = [];
    const ids = mediaIds.split(",");
    void Promise.all(ids.map(async (id) => {
      try {
        const blob = await request<Blob>(`/api/settings/public-bio/media/${id}`, { responseType: "blob", fallbackError: "Não foi possível carregar a imagem." });
        const url = URL.createObjectURL(blob);
        created.push(url);
        if (active) setMediaUrls((current) => ({ ...current, [id]: url }));
      } catch { /* A visualização mantém uma indicação de imagem indisponível. */ }
    }));
    return () => { active = false; created.forEach((url) => URL.revokeObjectURL(url)); };
  }, [firebaseUser, mediaIds, request]);

  const updateLink = (id: string, patch: Partial<BioLink>) => {
    if (patch.kind === "menu") patch.url = "#cardapio";
    else if (patch.kind === "promotions") patch.url = "#promocoes";
    else if (patch.kind && !patch.url) patch.url = "";
    setDraft((page) => ({ ...page, links: page.links.map((link) => link.id === id ? { ...link, ...patch } : link) }));
  };

  const updateImage = (gallery: "menuImages" | "promotionImages", id: string, patch: Partial<BioImage>) => {
    setDraft((page) => ({ ...page, [gallery]: page[gallery].map((item) => item.id === id ? { ...item, ...patch } : item) }));
  };

  const moveImage = (gallery: "menuImages" | "promotionImages", index: number, delta: number) => {
    setDraft((page) => {
      const images = [...page[gallery]];
      const target = index + delta;
      if (target < 0 || target >= images.length) return page;
      [images[index], images[target]] = [images[target], images[index]];
      return { ...page, [gallery]: images };
    });
  };

  const removeImage = (gallery: "menuImages" | "promotionImages", id: string) => {
    setDraft((page) => {
      const images = page[gallery].filter((item) => item.id !== id);
      const kind = gallery === "menuImages" ? "menu" : "promotions";
      return { ...page, [gallery]: images, links: images.length ? page.links : page.links.map((link) => link.kind === kind ? { ...link, enabled: false } : link) };
    });
  };

  const uploadImages = async (gallery: "menuImages" | "promotionImages", files: FileList | null) => {
    if (!files?.length) return;
    setMessage(null);
    const available = MAX_BIO_IMAGES - draft[gallery].length;
    if (files.length > available) return setMessage({ type: "error", text: `Esta galeria aceita até ${MAX_BIO_IMAGES} imagens.` });
    setUploading(gallery);
    try {
      for (const file of Array.from(files)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error("Envie imagens JPG, PNG ou WebP com até 8 MB cada.");
        const form = new FormData();
        form.set("file", file);
        const result = await request<{ id: string }>("/api/settings/public-bio/media", { method: "POST", body: form, fallbackError: "Falha ao enviar imagem." });
        setDraft((page) => ({ ...page,
          [gallery]: [...page[gallery], { id: result.id, alt: `${gallery === "menuImages" ? "Cardápio" : "Promoção"} Coala Shakes ${page[gallery].length + 1}` }],
          links: page.links.map((link) => link.kind === (gallery === "menuImages" ? "menu" : "promotions") ? { ...link, enabled: true, url: gallery === "menuImages" ? "#cardapio" : "#promocoes" } : link),
        }));
      }
      setPreviewGallery(gallery);
      setMessage({ type: "success", text: "Imagens enviadas. Salve o rascunho ou publique para conservar a nova ordem." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Falha ao enviar imagem." });
    } finally { setUploading(null); }
  };

  const moveLink = (index: number, delta: number) => {
    setDraft((page) => {
      const next = [...page.links];
      const target = index + delta;
      if (target < 0 || target >= next.length) return page;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...page, links: next };
    });
  };

  const submit = async (action: "save" | "publish") => {
    setMessage(null);
    if (action === "publish") {
      const issue = validateBioForPublish(draft);
      if (issue) return setMessage({ type: "error", text: issue });
    }
    setSaving(action);
    try {
      const data = await request<{ revision: number; publishedAt: string | null }>("/api/settings/public-bio", {
        method: "PUT",
        json: { action, expectedRevision: revision, page: draft },
        fallbackError: "Não foi possível salvar.",
      });
      setRevision(data.revision);
      setPublishedAt(data.publishedAt);
      setSaved(draft);
      setMessage({ type: "success", text: action === "publish" ? "Página publicada. Os links já estão disponíveis para visitantes." : "Rascunho salvo. A página pública ainda não mudou." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Erro ao salvar." });
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className="min-w-0 space-y-6">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold">Identidade da página</h3>
          <p className="mt-1 text-sm text-muted-foreground">A logo oficial aparece no topo. Ajuste a frase de apresentação abaixo.</p>
          <div className="mt-5 grid gap-4">
            <label className="space-y-1.5 text-sm font-medium">Descrição curta
              <Textarea value={draft.description} maxLength={160} rows={2} onChange={(event) => setDraft((page) => ({ ...page, description: event.target.value }))} />
            </label>
          </div>
        </div>

        {(["menuImages", "promotionImages"] as const).map((gallery) => <div key={gallery} className="rounded-2xl border bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold">{gallery === "menuImages" ? "Imagens do cardápio" : "Imagens das promoções"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">Envie JPG, PNG ou WebP (até 8 MB). Otimizamos cada imagem para o celular. Use as setas para definir a ordem.</p>
          {gallery === "menuImages" ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Ao abrir o cardápio, o visitante verá o aviso: “A disponibilidade dos produtos pode variar conforme a unidade.”</p> : null}
          <label className={`mt-4 inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm font-medium ${uploading || draft[gallery].length >= MAX_BIO_IMAGES ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}>
            {uploading === gallery ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Adicionar imagens
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!uploading || draft[gallery].length >= MAX_BIO_IMAGES} onChange={(event) => { void uploadImages(gallery, event.target.files); event.target.value = ""; }} />
          </label>
          <span className="ml-3 text-xs text-muted-foreground">{draft[gallery].length}/{MAX_BIO_IMAGES}</span>
          <div className="mt-4 space-y-3">{draft[gallery].map((item, index) => <div key={item.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center">
            <div className="h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">{mediaUrls[item.id] ? <Image src={mediaUrls[item.id]} alt={item.alt} width={160} height={192} unoptimized className="h-full w-full object-cover" /> : null}</div>
            <div className="min-w-0 flex-1"><span className="text-xs font-semibold text-muted-foreground">Imagem {index + 1}</span><Input aria-label={`Descrição da imagem ${index + 1}`} value={item.alt} maxLength={100} className="mt-1" onChange={(event) => updateImage(gallery, item.id, { alt: event.target.value })} /></div>
            <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" aria-label="Mover imagem para cima" disabled={index === 0} onClick={() => moveImage(gallery, index, -1)}><ArrowUp className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label="Mover imagem para baixo" disabled={index === draft[gallery].length - 1} onClick={() => moveImage(gallery, index, 1)}><ArrowDown className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label="Remover imagem" onClick={() => removeImage(gallery, item.id)}><Trash2 className="h-4 w-4" /></Button></div>
          </div>)}</div>
        </div>)}

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-base font-bold">Botões da página</h3><p className="mt-1 text-sm text-muted-foreground">Use as setas para ordenar e ative só os links que quer mostrar.</p></div>
            <Button type="button" size="sm" variant="outline" disabled={draft.links.length >= 12} onClick={() => setDraft((page) => ({ ...page, links: [...page.links, { id: crypto.randomUUID(), kind: "other", label: "Novo link", subtitle: "", placement: "quick", url: "", enabled: false }] }))}><Plus className="mr-1 h-4 w-4" />Adicionar</Button>
          </div>
          <div className="mt-5 space-y-3">
            {draft.links.map((link, index) => (
              <div key={link.id} className="rounded-xl border bg-[#fdfbfc] p-4">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={link.enabled} onChange={(event) => updateLink(link.id, { enabled: event.target.checked })} aria-label={`Mostrar ${link.label}`} className="h-4 w-4 accent-[#e84f96]" />
                  <span className="flex-1 text-sm font-semibold">{link.label || "Novo link"}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label="Mover para cima" disabled={index === 0} onClick={() => moveLink(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Mover para baixo" disabled={index === draft.links.length - 1} onClick={() => moveLink(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remover link" onClick={() => setDraft((page) => ({ ...page, links: page.links.filter((entry) => entry.id !== link.id) }))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">Tipo
                    <select value={link.kind} onChange={(event) => updateLink(link.id, { kind: event.target.value as BioLink["kind"] })} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm text-foreground">
                      {kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">Texto do botão
                    <Input value={link.label} maxLength={48} onChange={(event) => updateLink(link.id, { label: event.target.value })} />
                  </label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">Exibição
                    <select value={link.placement} onChange={(event) => updateLink(link.id, { placement: event.target.value as BioLink["placement"] })} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm text-foreground">
                      <option value="featured">Botão principal</option><option value="quick">Acesso rápido</option>
                    </select>
                  </label>
                  {link.placement === "quick" ? <label className="space-y-1 text-xs font-medium text-muted-foreground">Texto complementar
                    <Input value={link.subtitle} maxLength={80} onChange={(event) => updateLink(link.id, { subtitle: event.target.value })} />
                  </label> : null}
                </div>
                {link.kind === "menu" || link.kind === "promotions" ? <p className="mt-3 text-xs text-muted-foreground">Abre a galeria de {link.kind === "menu" ? "cardápio" : "promoções"} nesta página. Envie ao menos uma imagem para ativar.</p> : <label className="mt-3 block space-y-1 text-xs font-medium text-muted-foreground">Endereço público (https://)
                  <Input type="url" inputMode="url" placeholder="https://" value={link.url} maxLength={2048} onChange={(event) => updateLink(link.id, { url: event.target.value })} />
                </label>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={!!saving || !!uploading || !dirty} onClick={() => void submit("save")}>{saving === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar rascunho</Button>
          <Button type="button" disabled={!!saving || !!uploading} onClick={() => void submit("publish")}>{saving === "publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Publicar página</Button>
          <span className="text-xs text-muted-foreground">{publishedAt ? `Última publicação: ${new Date(publishedAt).toLocaleString("pt-BR")}` : "Ainda não publicada"}</span>
        </div>
        {message ? <p role="status" className={`rounded-lg border px-4 py-3 text-sm ${message.type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}>{message.text}</p> : null}
      </div>

      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><p className="text-sm font-bold">Prévia ao vivo</p><p className="text-xs text-muted-foreground">O visitante só vê a versão publicada.</p></div>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">{([ ["page", "Página"], ["menuImages", "Cardápio"], ["promotionImages", "Promoções"] ] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={previewGallery === value ? "default" : "outline"} onClick={() => setPreviewGallery(value)}>{label}</Button>)}</div>
        <BioPreview page={draft} mediaUrls={mediaUrls} gallery={previewGallery} />
        <div className="mt-5 rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold">Link da página</h3>
          <p className="mt-1 break-all text-sm text-[#173768]">{publicUrl}</p>
          <p className="mt-1 text-xs text-muted-foreground">O endereço curto fica ativo após a publicação e a conexão do domínio.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void copyPublicUrl()}><Copy className="mr-1.5 h-4 w-4" />Copiar link</Button>
            <Button asChild size="sm" variant="outline"><a href={publicUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" />Acessar página</a></Button>
          </div>
          {qrDataUrl ? <div className="mt-5 flex flex-col items-center border-t pt-4">
            <Image src={qrDataUrl} alt="QR Code da página pública Coala Shakes" width={180} height={180} unoptimized />
            <a className="mt-2 text-sm font-semibold text-[#087fa2] underline underline-offset-2" href={qrDataUrl} download="coala-shakes-bio-qr.png">Baixar QR Code</a>
          </div> : null}
        </div>
      </aside>
    </div>
  );
}
