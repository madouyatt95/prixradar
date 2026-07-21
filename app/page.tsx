import type { Metadata } from "next";
import { PriceRadarApp } from "./components/price-radar-app";

export const metadata: Metadata = {
  title: "PrixRadar — Les vraies anomalies de prix, vérifiées",
  description:
    "Surveillez les baisses de prix inhabituelles en France et sur Amazon Europe, puis recevez des alertes expliquées et vérifiées.",
};

export default function Home() {
  return <PriceRadarApp />;
}
