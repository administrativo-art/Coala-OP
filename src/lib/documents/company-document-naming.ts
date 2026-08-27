/**
 * Padrao de nomenclatura dos documentos da empresa: nome sempre derivado de
 * categoria + titulo + data de upload, nunca escolhido livremente pelo
 * usuario ou pela IA - evita arquivos "documento-final-v2.pdf" no acervo.
 *
 * Formato: CATEGORIA_TITULO_AAAAMMDD.ext
 */

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

export function buildStandardizedFileName(input: {
  category: string;
  title: string;
  uploadedAt: Date;
  extension: string;
}): string {
  const { category, title, uploadedAt, extension } = input;
  const y = uploadedAt.getFullYear();
  const m = String(uploadedAt.getMonth() + 1).padStart(2, "0");
  const d = String(uploadedAt.getDate()).padStart(2, "0");
  const categorySlug = slug(category) || "SEM-CATEGORIA";
  const titleSlug = slug(title) || "SEM-TITULO";
  return `${categorySlug}_${titleSlug}_${y}${m}${d}.${extension}`;
}
