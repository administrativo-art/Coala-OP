import Documents from "../../dp/documents/page";
import { PageContainer } from "@/components/layout/page-container";
import { AcervoNavigation } from "@/features/documents/central/acervo-navigation";
export default function CollaboratorArchivePage() {
  return <PageContainer><AcervoNavigation /><Documents /></PageContainer>;
}
