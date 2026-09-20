"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Heart, Loader2, MapPin, Megaphone, MessageCircle, NotebookText, Plus, Sparkles, Trash2 } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { type BioImage, type BioLink, type BioMomentProduct, type BioPage, defaultBioPage, MAX_BIO_IMAGES, uploadedBioProductImageId, validateBioForPublish } from "@/lib/public-bio";

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

function productPreviewSrc(image: string, mediaUrls: Record<string, string>): string | null {
  if (image.startsWith("builtin:")) return `/images/bio-products/${image.slice(8)}.webp`;
  const id = uploadedBioProductImageId(image);
  return id ? mediaUrls[id] ?? null : null;
}

function previewUnitStatus(id: string): { label: string; open: boolean } {
  const hours = id === "joao-paulo" ? [10, 22, 8, 14] : id === "calhau" ? [9, 21, 9, 15] : [10, 22, 9, 15];
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Fortaleza", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const sunday = parts.find((part) => part.type === "weekday")?.value === "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const opening = sunday ? hours[2] : hours[0];
  const closing = sunday ? hours[3] : hours[1];
  return hour >= opening && hour < closing ? { label: "Aberto agora", open: true } : { label: "Fechado", open: false };
}

function BioPreview({ page, mediaUrls, gallery }: { page: BioPage; mediaUrls: Record<string, string>; gallery: "page" | "menuImages" | "promotionImages" }) {
  const visible = page.links.filter((link) => link.enabled);
  const menu = visible.find((link) => link.kind === "menu");
  const whatsapp = visible.find((link) => link.kind === "whatsapp");
  const promotion = visible.find((link) => link.kind === "promotions");
  const activePromotion = promotion && page.promotionImages.length ? promotion : null;
  const locations = visible.filter((link) => link.kind === "location");
  const extras = visible.filter((link) => !["menu", "whatsapp", "promotions", "location"].includes(link.kind));
  return (
    <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-[28px] border-[7px] border-[#e6f1f9] bg-[#fff9f0] text-[#173659] shadow-[0_20px_50px_rgba(28,55,83,.17)]">
      <div className="relative overflow-hidden bg-[#fff9f0]">
        {gallery !== "page" ? <div className="relative min-h-[560px] px-4 pb-6 pt-8">
          <h4 className="text-center text-2xl font-black text-[#df2c83]">{gallery === "menuImages" ? "Cardápio" : "Promoções"}</h4>
          {gallery === "menuImages" ? <p className="mx-auto mt-3 max-w-[270px] rounded-xl bg-[#fff0d1] px-3 py-2 text-xs font-semibold">A disponibilidade dos produtos pode variar conforme a unidade.</p> : null}
          {page[gallery].length ? <div className="mt-5 space-y-3">{page[gallery].map((item, index) => <div key={item.id} className="overflow-hidden rounded-xl bg-white shadow-sm">
            {mediaUrls[item.id] ? <Image src={mediaUrls[item.id]} alt={item.alt} width={600} height={900} unoptimized className="h-auto w-full" /> : <div className="flex h-36 items-center justify-center text-xs">Carregando imagem…</div>}
            <p className="p-2 text-xs">{index + 1} de {page[gallery].length}</p>
          </div>)}</div> : <p className="mt-8 text-sm">Envie imagens para montar esta galeria.</p>}
        </div> : <>
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rotate-[-15deg] bg-contain bg-center bg-no-repeat opacity-20" style={{ backgroundImage: 'url("/images/coala-bio-pattern-pink.png")' }} />
        <div className="relative mx-auto mt-2 h-[90px] w-[185px]"><Image src="/images/coala-bio-logo-final.svg" fill alt={page.title} className="object-contain" /></div>
        {locations.length ? <div className="relative grid grid-cols-2 gap-1.5 px-4 pb-2">{locations.map((link) => {
          const status = previewUnitStatus(link.id);
          return <div key={link.id} className={`rounded-full border px-2 py-2 text-center text-[10px] font-black ${status.open ? "border-[#b9e5ce] bg-[#effaf3] text-[#168d53]" : "border-[#f6c7d9] bg-[#fff5f9] text-[#d43b83]"}`}>● {link.label.replace(/^Unidade\s+/i, "")} · {status.label}</div>;
        })}</div> : null}
        <div className="relative space-y-2 px-4">
          {menu ? <div className="flex min-h-11 items-center gap-2 rounded-full bg-[#df2c83] px-4 text-sm font-extrabold text-white"><NotebookText size={18} />Ver cardápio<span className="ml-auto">›</span></div> : null}
          {whatsapp ? <div className="flex min-h-11 items-center gap-2 rounded-full bg-[#168d53] px-4 text-sm font-extrabold text-white"><MessageCircle size={18} />Fale no WhatsApp<span className="ml-auto">›</span></div> : null}
          {locations.length ? <div className="flex min-h-11 items-center gap-2 rounded-full border border-[#f5c9dc] bg-[#fff9ee] px-4 text-sm font-extrabold text-[#df2c83]"><MapPin size={18} />Ver unidades<span className="ml-auto">›</span></div> : null}
        </div>
        <div className="relative mx-4 mt-4 flex min-h-14 items-center gap-2 rounded-xl bg-[#18385d] px-3 text-white">
          {activePromotion ? page.promotionIcon === "megaphone" ? <Megaphone size={20} className="shrink-0 text-[#df2c83]" /> : page.promotionIcon === "sparkles" ? <Sparkles size={20} className="shrink-0 text-[#df2c83]" /> : <Heart size={20} fill="#df2c83" className="shrink-0 text-[#df2c83]" /> : <Megaphone size={20} className="shrink-0 text-[#df2c83]" />}
          <div className="min-w-0 flex-1"><span className="block text-[8px] font-black uppercase tracking-widest text-[#e6b4cb]">{activePromotion?.label || "Novidades em breve"}</span><strong className="block text-[10px] leading-tight">{activePromotion ? activePromotion.subtitle || "Confira as novidades da Coala Shakes" : "Fique de olho: promoções imperdíveis vêm aí!"}</strong></div>
          <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[8px] font-black text-[#18385d]">{activePromotion ? "Quero meu" : "Em breve"}</span>
        </div>
        <div className="relative px-4 pt-6"><h4 className="text-[17px] font-black">Sabores do momento</h4><div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {page.momentProducts.filter((product) => product.name && product.image).map((product, index) => <div key={`${product.image}-${index}`} className="w-[132px] shrink-0 overflow-hidden rounded-2xl border border-[#edf0f4] bg-white pb-2 shadow-sm">
            {productPreviewSrc(product.image, mediaUrls) ? <Image src={productPreviewSrc(product.image, mediaUrls)!} alt={product.name} width={132} height={150} unoptimized className="h-[154px] w-full bg-[#f2f8fc] object-cover object-[center_60%]" /> : <div className="h-[154px]" />}
            <span className="block px-2 py-1 text-center text-[11px] font-black leading-tight">{product.name}</span>
          </div>)}
        </div></div>
        {locations.length ? <div className="relative px-4 pt-5"><h4 className="text-[17px] font-black">Nossas unidades</h4><div className="mt-3 space-y-2">{locations.map((link) => {
          const status = previewUnitStatus(link.id);
          return <div key={link.id} className="rounded-xl border border-[#e7edf1] bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-2"><strong className="text-lg font-black">{link.label.replace(/^Unidade\s+/i, "")}</strong><span className={`shrink-0 text-[11px] font-bold ${status.open ? "text-[#168d53]" : "text-[#d43b83]"}`}><span className={status.open ? "animate-pulse" : ""}>●</span> {status.label}</span></div><p className="mt-3 text-xs leading-relaxed text-[#63708b]">{link.subtitle}</p><div className="mt-4 flex gap-2"><span className="flex min-h-9 flex-1 items-center justify-center rounded-full bg-[#fff3f8] px-2 text-center text-[11px] font-bold text-[#d83284]">⌖ Ver no mapa</span>{whatsapp ? <span className="flex min-h-9 flex-1 items-center justify-center rounded-full bg-[#effbf4] px-2 text-center text-[11px] font-bold text-[#168d53]">◉ WhatsApp</span> : null}</div></div>;
        })}</div></div> : null}
        {extras.length ? <div className="mx-4 mt-5 space-y-2">{extras.map((link) => <div key={link.id} className="flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-xs font-bold"><ExternalLink size={14} />{link.label}</div>)}</div> : null}
        <div className="relative mt-6 flex min-h-44 flex-col items-center justify-center gap-1 border-t border-[#f2eee9]"><p className="-rotate-6 text-center text-[26px] font-bold leading-[.96] text-[#df2c83]" style={{ fontFamily: '"Bradley Hand", "Comic Sans MS", cursive' }}>Mais<br />que sorvete,<br />é felicidade<br />em copo! ♡</p><small className="mt-3 text-[8px] text-[#899db1]">© Coala Shakes · São Luís, MA</small></div>
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
  const [uploadingProduct, setUploadingProduct] = useState<number | null>(null);
  const [previewGallery, setPreviewGallery] = useState<"page" | "menuImages" | "promotionImages">("page");
  const mediaIds = [...new Set([...draft.menuImages, ...draft.promotionImages].map((item) => item.id)
    .concat(draft.momentProducts.map((product) => uploadedBioProductImageId(product.image)).filter((id): id is string => Boolean(id))))]
    .sort().join(",");
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const promotionDraftLink = draft.links.find((link) => link.kind === "promotions");

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

  const updateMomentProduct = (index: number, patch: Partial<BioMomentProduct>) => {
    setDraft((page) => ({ ...page, momentProducts: page.momentProducts.map((product, position) => position === index ? { ...product, ...patch } : product) }));
  };

  const moveMomentProduct = (index: number, delta: number) => {
    setDraft((page) => {
      const products = [...page.momentProducts];
      const target = index + delta;
      if (target < 0 || target >= products.length) return page;
      [products[index], products[target]] = [products[target], products[index]];
      return { ...page, momentProducts: products };
    });
  };

  const uploadMomentProduct = async (index: number, file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setMessage({ type: "error", text: "Envie JPG, PNG ou WebP com até 8 MB." });
      return;
    }
    setUploadingProduct(index);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await request<{ id: string }>("/api/settings/public-bio/media", { method: "POST", body: form, fallbackError: "Falha ao enviar foto do produto." });
      setDraft((page) => ({ ...page, momentProducts: page.momentProducts.map((product, position) => position === index
        ? { ...product, image: `uploaded:${result.id}`, name: product.name || file.name.replace(/\.[^.]+$/, "").slice(0, 64) }
        : product) }));
      setPreviewGallery("page");
      setMessage({ type: "success", text: "Foto enviada. Salve o rascunho para conservar a alteração." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Falha ao enviar foto." });
    } finally { setUploadingProduct(null); }
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

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold">Produtos do momento</h3>
          <p className="mt-1 text-sm text-muted-foreground">Oito posições para foto e nome. As fotos enviadas já estão preenchidas; você pode trocar, esvaziar ou mudar a ordem.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {draft.momentProducts.map((product, index) => <div key={index} className="rounded-xl border bg-[#fdfbfc] p-3">
              <div className="mb-2 flex items-center gap-2"><strong className="flex-1 text-xs">Posição {index + 1}</strong><Button type="button" variant="ghost" size="icon" aria-label={`Subir produto ${index + 1}`} disabled={index === 0 || uploadingProduct !== null} onClick={() => moveMomentProduct(index, -1)}><ArrowUp className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={`Descer produto ${index + 1}`} disabled={index === 7 || uploadingProduct !== null} onClick={() => moveMomentProduct(index, 1)}><ArrowDown className="h-4 w-4" /></Button></div>
              <div className="flex gap-3"><div className="h-28 w-24 shrink-0 overflow-hidden rounded-lg bg-white">{productPreviewSrc(product.image, mediaUrls) ? <Image src={productPreviewSrc(product.image, mediaUrls)!} alt={product.name || `Produto ${index + 1}`} width={96} height={112} unoptimized className="h-full w-full object-contain" /> : null}</div>
                <div className="min-w-0 flex-1 space-y-2"><Input aria-label={`Nome do produto ${index + 1}`} placeholder="Nome do produto" maxLength={64} value={product.name} onChange={(event) => updateMomentProduct(index, { name: event.target.value })} />
                  <label className={`inline-flex cursor-pointer items-center rounded-md border px-2 py-1.5 text-xs font-semibold ${uploadingProduct !== null ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}>
                    {uploadingProduct === index ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}Trocar foto
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploadingProduct !== null || !!uploading} onChange={(event) => { void uploadMomentProduct(index, event.target.files?.[0]); event.target.value = ""; }} />
                  </label>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={uploadingProduct !== null || (!product.name && !product.image)} onClick={() => updateMomentProduct(index, { name: "", image: "" })}>Esvaziar</Button>
                </div>
              </div>
            </div>)}
          </div>
        </div>

        {(["menuImages", "promotionImages"] as const).map((gallery) => <div key={gallery} className="rounded-2xl border bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold">{gallery === "menuImages" ? "Imagens do cardápio" : "Imagens das promoções"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">Envie JPG, PNG ou WebP (até 8 MB). Otimizamos cada imagem para o celular. Use as setas para definir a ordem.</p>
          {gallery === "menuImages" ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Ao abrir o cardápio, o visitante verá o aviso: “A disponibilidade dos produtos pode variar conforme a unidade.”</p> : null}
          {gallery === "promotionImages" ? <div className="mt-4 rounded-xl border border-[#f5dbe7] bg-[#fff8fb] p-4">
            <h4 className="text-sm font-bold">Texto da faixa de promoção</h4>
            <p className="mt-1 text-xs text-muted-foreground">Sem imagens de promoção publicadas, a faixa mostra um aviso de novidades em breve. Com imagens e o link ativo, ela usa os textos e o símbolo abaixo.</p>
            {promotionDraftLink ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-muted-foreground">Símbolo na frente
                <select value={draft.promotionIcon} onChange={(event) => setDraft((page) => ({ ...page, promotionIcon: event.target.value as BioPage["promotionIcon"] }))} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm text-foreground">
                  <option value="heart">Coração</option><option value="megaphone">Megafone</option><option value="sparkles">Brilhos</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">Título pequeno
                <Input value={promotionDraftLink.label} maxLength={48} onChange={(event) => updateLink(promotionDraftLink.id, { label: event.target.value })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">Chamada da promoção
                <Textarea value={promotionDraftLink.subtitle} maxLength={80} rows={2} onChange={(event) => updateLink(promotionDraftLink.id, { subtitle: event.target.value })} />
              </label>
            </div> : <p className="mt-3 text-xs text-muted-foreground">Adicione um link do tipo “Promoções” em Botões da página para configurar esta faixa.</p>}
          </div> : null}
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
                  {link.kind === "promotions" ? <p className="self-end text-xs text-muted-foreground">Edite o símbolo, o título pequeno e a chamada em “Imagens das promoções”.</p> : <label className="space-y-1 text-xs font-medium text-muted-foreground">Texto do botão
                    <Input value={link.label} maxLength={48} onChange={(event) => updateLink(link.id, { label: event.target.value })} />
                  </label>}
                </div>
                {link.kind !== "promotions" ? <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">Exibição
                    <select value={link.placement} onChange={(event) => updateLink(link.id, { placement: event.target.value as BioLink["placement"] })} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm text-foreground">
                      <option value="featured">Botão principal</option><option value="quick">Acesso rápido</option>
                    </select>
                  </label>
                  {link.placement === "quick" ? <label className="space-y-1 text-xs font-medium text-muted-foreground">Texto complementar
                    <Input value={link.subtitle} maxLength={80} onChange={(event) => updateLink(link.id, { subtitle: event.target.value })} />
                  </label> : null}
                </div> : null}
                {link.kind === "menu" || link.kind === "promotions" ? <p className="mt-3 text-xs text-muted-foreground">Abre a galeria de {link.kind === "menu" ? "cardápio" : "promoções"} nesta página. Envie ao menos uma imagem para ativar.</p> : <label className="mt-3 block space-y-1 text-xs font-medium text-muted-foreground">Endereço público (https://)
                  <Input type="url" inputMode="url" placeholder="https://" value={link.url} maxLength={2048} onChange={(event) => updateLink(link.id, { url: event.target.value })} />
                </label>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={!!saving || !!uploading || uploadingProduct !== null || !dirty} onClick={() => void submit("save")}>{saving === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar rascunho</Button>
          <Button type="button" disabled={!!saving || !!uploading || uploadingProduct !== null} onClick={() => void submit("publish")}>{saving === "publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Publicar página</Button>
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
