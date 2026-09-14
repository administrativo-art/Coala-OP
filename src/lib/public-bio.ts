import { z } from "zod";

export const bioLinkKindSchema = z.enum([
  "menu",
  "promotions",
  "whatsapp",
  "delivery",
  "location",
  "instagram",
  "other",
]);

export const bioLinkSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  kind: bioLinkKindSchema,
  label: z.string().trim().min(1).max(48),
  subtitle: z.string().trim().max(80),
  placement: z.enum(["featured", "quick"]),
  url: z.string().trim().max(2048),
  enabled: z.boolean(),
});

export const bioImageSchema = z.object({
  id: z.string().uuid(),
  alt: z.string().trim().min(1).max(100),
});

export const MAX_BIO_IMAGES = 12;

export const bioProductSlugs = [
  "milkshake-leite-ninho", "milkshake-ninhomaltine", "milkshake-nutella", "milkshake-oreo",
  "mix-cafe-nutella", "mix-farinha-lactea", "mix-ninhomaltine", "mix-nutella-ovomaltine", "mix-nesquik-fini",
] as const;

const builtInProductImages = new Set<string>(bioProductSlugs.map((slug) => `builtin:${slug}`));
const uploadedProductImagePattern = /^uploaded:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const defaultMomentProducts = [
  { name: "Milkshake Leite Ninho", image: "builtin:milkshake-leite-ninho" },
  { name: "Milkshake NinhoMaltine", image: "builtin:milkshake-ninhomaltine" },
  { name: "Milkshake Nutella", image: "builtin:milkshake-nutella" },
  { name: "Milkshake Oreo", image: "builtin:milkshake-oreo" },
  { name: "Mix Café com Nutella", image: "builtin:mix-cafe-nutella" },
  { name: "Mix Farinha Láctea", image: "builtin:mix-farinha-lactea" },
  { name: "Mix NinhoMaltine", image: "builtin:mix-ninhomaltine" },
  { name: "Mix Nutella e Ovomaltine", image: "builtin:mix-nutella-ovomaltine" },
];

export function uploadedBioProductImageId(value: string): string | null {
  return uploadedProductImagePattern.exec(value)?.[1] ?? null;
}

export const bioMomentProductSchema = z.object({
  name: z.string().trim().max(64),
  image: z.string().max(100).refine((value) => value === "" || builtInProductImages.has(value) || uploadedProductImagePattern.test(value)),
});

export const bioPageSchema = z.object({
  title: z.string().trim().min(1).max(48),
  description: z.string().trim().max(160),
  links: z.array(bioLinkSchema).max(12),
  menuImages: z.array(bioImageSchema).max(MAX_BIO_IMAGES).default([]),
  promotionImages: z.array(bioImageSchema).max(MAX_BIO_IMAGES).default([]),
  momentProducts: z.array(bioMomentProductSchema).length(8).default(defaultMomentProducts),
}).superRefine((page, context) => {
  const ids = new Set<string>();
  page.links.forEach((link, index) => {
    if (ids.has(link.id)) {
      context.addIssue({ code: "custom", path: ["links", index, "id"], message: "Link duplicado." });
    }
    ids.add(link.id);
  });
});

export type BioPage = z.infer<typeof bioPageSchema>;
export type BioLink = BioPage["links"][number];
export type BioImage = BioPage["menuImages"][number];
export type BioMomentProduct = BioPage["momentProducts"][number];

export const defaultBioPage: BioPage = {
  title: "Coala Shakes",
  description: "Sorvete soft, Milkshakes, Mix e Sundaes.",
  menuImages: [],
  promotionImages: [],
  momentProducts: defaultMomentProducts,
  links: [
    { id: "menu-featured", kind: "menu", label: "Ver cardápio", subtitle: "", placement: "featured", url: "#cardapio", enabled: false },
    { id: "whatsapp-featured", kind: "whatsapp", label: "Fale no WhatsApp", subtitle: "", placement: "featured", url: "https://wa.me/5598999072739?text=Oi%21%20Vim%20pelo%20Instagram%20da%20Coala%20Shakes.", enabled: true },
    { id: "menu-quick", kind: "menu", label: "Cardápio", subtitle: "Descubra todas as delícias", placement: "quick", url: "#cardapio", enabled: false },
    { id: "tirirical", kind: "location", label: "Unidade Tirirical", subtitle: "Mix Mateus Tirirical · Seg–sáb 10h–22h · Dom 9h–15h", placement: "quick", url: "https://www.google.com/maps/search/?api=1&query=Mix+Mateus+Tirirical%2C+Sao+Luis%2C+MA", enabled: true },
    { id: "joao-paulo", kind: "location", label: "Unidade João Paulo", subtitle: "Mix Mateus João Paulo · Seg–sáb 10h–22h · Dom 8h–14h", placement: "quick", url: "https://www.google.com/maps/search/?api=1&query=Mix+Mateus+Joao+Paulo%2C+Sao+Luis%2C+MA", enabled: true },
    { id: "calhau", kind: "location", label: "Unidade Calhau", subtitle: "Shopping do Automóvel · Seg–sáb 9h–21h · Dom 9h–15h", placement: "quick", url: "https://www.google.com/maps/search/?api=1&query=Shopping+do+Automovel%2C+Sao+Luis%2C+MA", enabled: true },
    { id: "whatsapp-quick", kind: "whatsapp", label: "WhatsApp", subtitle: "Fale com a nossa equipe", placement: "quick", url: "https://wa.me/5598999072739?text=Oi%21%20Vim%20pelo%20Instagram%20da%20Coala%20Shakes.", enabled: true },
    { id: "promotions", kind: "promotions", label: "Promoções", subtitle: "Fique por dentro das novidades", placement: "quick", url: "#promocoes", enabled: false },
  ],
};

/** Only public HTTPS destinations are allowed; no internal system route can be published. */
export function isSafeBioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (host === "op.coalashakes.com" || host.endsWith(".op.coalashakes.com")) return false;
    if (host.startsWith("[") || /^[\d.]+$/.test(host)) return false;
    if (/^\/(dashboard|admin|api|login|sistema)(\/|$)/i.test(url.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function validateBioForPublish(page: BioPage): string | null {
  if (page.momentProducts.some((product) => Boolean(product.name) !== Boolean(product.image))) {
    return "Complete a foto e o nome de cada produto do momento ou deixe a posição vazia.";
  }
  const enabled = page.links.filter((link) => link.enabled);
  if (!enabled.length) return "Ative ao menos um link antes de publicar.";
  const invalid = enabled.find((link) => !isValidBioDestination(link, page));
  if (invalid) return `Informe um destino público e válido para “${invalid.label}”.`;
  return null;
}

export function isValidBioDestination(link: BioLink, page: BioPage): boolean {
  if (link.kind === "menu") return link.url === "#cardapio" && page.menuImages.length > 0;
  if (link.kind === "promotions") return link.url === "#promocoes" && page.promotionImages.length > 0;
  return isSafeBioUrl(link.url);
}

export function publicBioProjection(value: unknown): BioPage | null {
  const parsed = bioPageSchema.safeParse(value);
  if (!parsed.success || validateBioForPublish(parsed.data)) return null;
  const enabled = parsed.data.links.filter((link) => link.enabled);
  return {
    title: parsed.data.title,
    description: parsed.data.description,
    menuImages: enabled.some((link) => link.kind === "menu") ? parsed.data.menuImages : [],
    promotionImages: enabled.some((link) => link.kind === "promotions") ? parsed.data.promotionImages : [],
    momentProducts: parsed.data.momentProducts.filter((product) => product.name && product.image),
    links: enabled
      .map(({ id, kind, label, subtitle, placement, url }) => ({ id, kind, label, subtitle, placement, url, enabled: true })),
  };
}
