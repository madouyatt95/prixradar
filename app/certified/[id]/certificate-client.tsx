"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import styles from "./certificate.module.css";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, fallback = "Non disponible") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function money(cents: unknown, currency: unknown) {
  const value = number(cents);
  if (value === null) return "Total non confirmé";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency === "GBP" ? "GBP" : "EUR" }).format(value / 100);
}

function date(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "Non disponible";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const CHECK_LABELS: Record<string, string> = {
  liveSource: "Source réellement connectée",
  secondVerification: "Deux lectures concordantes",
  exactVariant: "Variante exacte confirmée",
  trustedSeller: "Vendeur suffisamment fiable",
  totalConfirmed: "Total confirmé au panier",
  publiclyAccessible: "Prix accessible à tous",
  eligibleEvidence: "Preuves suffisantes pour notifier",
};

export default function CertificateClient({ alertId }: { alertId: string }) {
  const [payload, setPayload] = useState<UnknownRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/certified/${encodeURIComponent(alertId)}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = record(await response.json().catch(() => ({})));
        if (!response.ok || body.ok !== true) throw new Error("certificate");
        return record(body.passport);
      })
      .then((passport) => { if (active) setPayload(passport); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [alertId]);

  if (failed) return <main className={styles.page}><section className={styles.empty}><p className={styles.brand}>PrixRadar · passeport de preuve</p><h1>Preuve indisponible</h1><p>Cette alerte n’existe pas, n’est pas LIVE ou sa preuve n’est pas encore accessible.</p><Link href="/">Retour au radar</Link></section></main>;
  if (!payload) return <main className={styles.page}><section className={styles.empty}><p className={styles.brand}>PrixRadar · passeport de preuve</p><h1>Chargement de la preuve…</h1></section></main>;

  const certification = record(payload.certification);
  const offer = record(payload.offer);
  const total = record(payload.total);
  const variant = record(payload.variant);
  const seller = record(payload.seller);
  const evidence = record(payload.evidence);
  const integrity = record(payload.integrity);
  const checks = record(certification.checks);
  const readings = Array.isArray(payload.readings) ? payload.readings.map(record) : [];
  const status = text(certification.status, "insufficient_evidence");
  const statusLabel = status === "certified" ? "Certifiée" : status === "expired" ? "Expirée" : "Preuves insuffisantes";

  return <main className={styles.page}>
    <header className={styles.topbar}><Link href="/" className={styles.logo}>PrixRadar</Link><Link href="/transparence">Notre méthode</Link></header>
    <article className={styles.card}>
      <div className={styles.hero}>
        <div><p className={styles.brand}>PrixRadar · passeport de preuve</p><h1>{text(offer.title)}</h1><p>{text(offer.merchant)} · {text(offer.market)} · {status === "certified" ? `certifié ${date(certification.certifiedAt)}` : `dossier généré ${date(payload.generatedAt)}`}</p></div>
        <div className={`${styles.status} ${status === "certified" ? styles.good : status === "expired" ? styles.expired : styles.warning}`}><span>{statusLabel}</span><strong>{money(total.finalTotalCents, total.currency)}</strong></div>
      </div>

      <section><h2>Ce qui a été contrôlé</h2><div className={styles.checks}>{Object.entries(CHECK_LABELS).map(([key, label]) => <div key={key} className={checks[key] === true ? styles.checkGood : styles.checkBad}><span>{checks[key] === true ? "OK" : "NON"}</span><strong>{label}</strong></div>)}</div></section>

      <section><h2>Lectures horodatées</h2><div className={styles.readings}>{readings.length === 0 ? <p>Aucune lecture publique disponible.</p> : readings.map((reading, index) => <div key={`${text(reading.observedAt)}-${index}`}><span>{index === 0 ? "Première lecture" : "Vérification"}</span><strong>{money(reading.totalCents, total.currency)}</strong><small>{date(reading.observedAt)} · {reading.available === false ? "indisponible" : "disponible"}</small></div>)}</div></section>

      <section className={styles.facts}><div><span>Variante</span><strong>{number(variant.confidence) === null ? "Non mesurée" : `${number(variant.confidence)} / 100`}</strong></div><div><span>Vendeur</span><strong>{number(seller.score) === null ? "Non mesuré" : `${number(seller.score)} / 100`}</strong></div><div><span>Historique</span><strong>{number(evidence.historyPoints) ?? 0} points</strong></div><div><span>Sincérité de la baisse</span><strong>{number(integrity.score) === null ? "À documenter" : `${number(integrity.score)} / 100`}</strong></div></section>

      <section className={styles.method}><h2>Limite de cette preuve</h2><p>Ce passeport présente les contrôles enregistrés par PrixRadar. Il s’agit d’une preuve applicative non notarifiée et non d’une signature du marchand. Le prix, le stock ou les conditions peuvent changer après la dernière lecture. Aucun achat n’est exécuté automatiquement.</p><p className={styles.proofId}>Identifiant du dossier : {text(certification.proofId)}</p></section>
    </article>
  </main>;
}
