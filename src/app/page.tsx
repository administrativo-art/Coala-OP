import type { Metadata } from "next";
import { headers } from "next/headers";

import VagasPage from "@/app/vagas/page";
import { RootHostSwitch } from "@/components/root-host-switch";
import { isPublicRecruitmentRequest } from "@/lib/public-recruitment-host";

const recruitmentMetadata: Metadata = {
  metadataBase: new URL("https://vagas.coalashakes.com"),
  title: "Vagas | Coala Shakes",
  description: "Cresça com a gente. Veja vagas abertas e cadastre-se no banco de talentos da Coala Shakes.",
  alternates: {
    canonical: "https://vagas.coalashakes.com",
  },
  openGraph: {
    title: "Vagas | Coala Shakes",
    description: "Cresça com a gente. Veja vagas abertas e cadastre-se no banco de talentos da Coala Shakes.",
    url: "https://vagas.coalashakes.com",
    siteName: "Coala Shakes",
    type: "website",
    locale: "pt_BR",
    images: [
      {
        url: "/icons/Icon PWM (192 x 192 px).png",
        width: 192,
        height: 192,
        alt: "Coala Shakes",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Vagas | Coala Shakes",
    description: "Cresça com a gente. Veja vagas abertas e cadastre-se no banco de talentos da Coala Shakes.",
    images: ["/icons/Icon PWM (192 x 192 px).png"],
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return isPublicRecruitmentRequest(await headers()) ? recruitmentMetadata : {};
}

export default async function RootPage() {
  if (isPublicRecruitmentRequest(await headers())) {
    return <VagasPage />;
  }

  return <RootHostSwitch />;
}
