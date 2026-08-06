import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Coala One",
    short_name: "Coala One",
    description: "Pessoas, processos e operação em um só lugar",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#F43F5E",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
