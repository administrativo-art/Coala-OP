import { DocumentGeneratorWorkspace } from "@/components/documents/document-generator-workspace";
import { DocumentNavigation } from "@/features/documents/central/document-navigation";
import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";

export default async function DocumentGeneratorPage(props: {
  searchParams: Promise<{ template?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const templateId = Array.isArray(searchParams.template) ? searchParams.template[0] : searchParams.template;
  return <PageContainer><div className="space-y-4"><DocumentNavigation active="generator" /><Link className="inline-block rounded-md border bg-white px-3 py-2 text-sm font-semibold text-teal-800" href="/dashboard/documents/generator/models">Criar e gerenciar modelos</Link><DocumentGeneratorWorkspace initialTemplateId={templateId} /></div></PageContainer>;
}
