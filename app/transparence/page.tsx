import type { Metadata } from "next";

import TransparencyClient from "./transparency-client";

export const metadata: Metadata = {
  title: "Fiabilité et méthode — PrixRadar",
  description: "Mesures publiques de fiabilité, échantillons et indice de sincérité PrixRadar.",
};

export default function TransparencyPage() {
  return <TransparencyClient />;
}
