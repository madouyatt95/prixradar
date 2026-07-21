import type { Metadata } from "next";

import CertificateClient from "./certificate-client";

export const metadata: Metadata = {
  title: "Passeport de preuve — PrixRadar",
  description: "Consultez le statut, les contrôles, les limites et les lectures horodatées d’une alerte PrixRadar.",
};

export default async function CertifiedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CertificateClient alertId={id} />;
}
