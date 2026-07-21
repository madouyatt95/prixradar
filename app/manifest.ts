import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PrixRadar — Alertes de prix vérifiées",
    short_name: "PrixRadar",
    description:
      "Repérez les baisses inhabituelles, comprenez le score et vérifiez avant d’acheter.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f5f1e8",
    theme_color: "#f5f1e8",
    lang: "fr",
    categories: ["shopping", "utilities"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
    shortcuts: [
      {
        name: "Ouvrir le radar",
        short_name: "Radar",
        description: "Voir les signaux récents",
        url: "/?view=radar",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
