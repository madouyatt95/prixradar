"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import styles from "./transparency.module.css";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function measurement(value: unknown) {
  const item = record(value);
  return {
    value: typeof item.value === "number" && Number.isFinite(item.value) ? item.value : null,
    unit: item.unit === "minutes" ? "minutes" : "percent",
    status: typeof item.status === "string" ? item.status : "unavailable",
    sample: typeof item.sampleSize === "number" ? item.sampleSize : 0,
    minimum: typeof item.minimumSampleSize === "number" ? item.minimumSampleSize : 0,
  };
}

function displayMetric(value: ReturnType<typeof measurement>) {
  if (value.value === null) return "En attente";
  return value.unit === "minutes" ? `${value.value.toLocaleString("fr-FR")} min` : `${value.value.toLocaleString("fr-FR")} %`;
}

const METRIC_LABELS = [
  ["usefulAlertRate", "Alertes jugées utiles"],
  ["falsePositiveRate", "Faux positifs"],
  ["totalPriceKnownRate", "Total livré connu"],
  ["doubleVerificationRate", "Double vérification"],
  ["notificationLatencyMedian", "Délai médian d’alerte"],
] as const;

export default function TransparencyClient() {
  const [metricsPayload, setMetricsPayload] = useState<UnknownRecord | null>(null);
  const [integrityPayload, setIntegrityPayload] = useState<UnknownRecord | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/public/metrics?days=30").then(async (response) => response.ok ? record(await response.json()) : null).catch(() => null),
      fetch("/api/integrity?limit=8").then(async (response) => response.ok ? record(await response.json()) : null).catch(() => null),
    ]).then(([metrics, integrity]) => { setMetricsPayload(metrics); setIntegrityPayload(integrity); });
  }, []);

  const reliability = record(metricsPayload?.reliability);
  const metrics = record(reliability.metrics);
  const sample = record(reliability.sample);
  const integrity = record(integrityPayload?.index);
  const integrityScore = typeof integrity.score === "number" ? integrity.score : null;
  const bySource = Array.isArray(reliability.bySource) ? reliability.bySource.map(record) : [];

  return <main className={styles.page}>
    <header className={styles.topbar}><Link href="/" className={styles.logo}>PrixRadar</Link><span>Transparence</span></header>
    <section className={styles.hero}><p className={styles.eyebrow}>Des chiffres, pas une promesse vague</p><h1>Voici comment nous mesurons la qualité des alertes.</h1><p>Les cartes restent volontairement vides tant que l’échantillon est trop petit. Les exemples de démonstration ne sont jamais inclus.</p></section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><p className={styles.eyebrow}>30 derniers jours</p><h2>Fiabilité observée</h2></div><span>{typeof sample.alerts === "number" ? `${sample.alerts} alertes LIVE` : "Mesures à venir"}</span></div><div className={styles.metrics}>{METRIC_LABELS.map(([key, label]) => { const value = measurement(metrics[key]); return <article key={key}><span>{label}</span><strong>{displayMetric(value)}</strong><small>{value.value === null ? `minimum ${value.minimum} mesures` : `${value.sample} mesures`}</small></article>; })}</div></section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Promotions</p><h2>Indice de sincérité</h2></div><span>{typeof integrity.sampleSize === "number" ? `${integrity.sampleSize} offres mesurées` : "Échantillon insuffisant"}</span></div><div className={styles.index}><strong>{integrityScore === null ? "—" : integrityScore}</strong><div><h3>{typeof integrity.label === "string" ? integrity.label : "Pas encore publiable"}</h3><p>Le score rapproche le total payable du plus bas prix antérieur sur 30 jours et de la médiane multi-enseignes. Il ne constitue pas une conclusion juridique sur un marchand.</p></div></div></section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Par connecteur</p><h2>État des échantillons</h2></div></div><div className={styles.sources}>{bySource.length === 0 ? <p>Aucune source ne dispose encore d’un échantillon public suffisant.</p> : bySource.map((source) => { const fp = measurement(source.falsePositiveRate); const total = measurement(source.totalPriceKnownRate); return <article key={String(source.key)}><strong>{String(source.key)}</strong><span>{typeof source.alerts === "number" ? `${source.alerts} alertes` : "—"}</span><small>Faux positifs : {displayMetric(fp)} · total connu : {displayMetric(total)}</small></article>; })}</div></section>

    <section className={styles.method}><h2>Règles de publication</h2><ol><li>Uniquement des alertes issues d’une source LIVE.</li><li>Aucun taux public avant le nombre minimal de mesures.</li><li>Une alerte n’est positive ou négative qu’après retours exploitables.</li><li>La disponibilité est revérifiée à 5, 15 et 30 minutes.</li></ol><Link href="/">Revenir au radar</Link></section>
  </main>;
}
