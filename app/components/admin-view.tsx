"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type SourceConfig = {
  id: string;
  source: string;
  market: string;
  displayName: string;
  discoveryUrl: string;
  category: string;
  enabled: boolean;
  cadenceMinutes: number;
  volatilityScore: number;
  lastRunAt: string | null;
  productsSeen: number;
  duplicateUrls: number;
  circuitState: "closed" | "open" | "half_open";
  failureStreak: number;
  antiBotStreak: number;
  cooldownUntil: string | null;
  pausedReason: string | null;
  dailyProductBudget: number;
  discoveryStrategy: "links" | "sitemap" | "feed" | "api";
  estimatedProductCount: number | null;
  uniqueProductsSeen: number;
  coveragePercent: number | null;
  contractStatus: "untested" | "passing" | "degraded" | "failing";
};

type DiscoverySegment = {
  id: string;
  market: string;
  label: string;
  minPriceCents: number;
  maxPriceCents: number;
  dailyTokenBudget: number;
  cadenceMinutes: number;
  priority: number;
  enabled: boolean;
};

type ProductReview = {
  id: string;
  canonicalProductId: string | null;
  source: string;
  market: string;
  externalId: string;
  title: string;
  brand: string | null;
  model: string | null;
  gtin: string | null;
  matchMethod: string;
  matchScore: number;
};

type Metrics = {
  productsSeen: number;
  antiBotBlocks: number;
  keepaRequests: number;
  apifyCostEuros: number;
  keepaEstimatedCostEuros: number;
  costPerExploitableAlertEuros: number | null;
  exploitableAlerts: number;
  alertsInReview: number;
  conditionalPrices: number;
  feedback: { total: number; useful: number; falsePositive: number; expired: number; averageLifetimeMinutes?: number };
  autonomy: {
    analyzed: number; cartsConfirmed: number; trueAnomalies: number; riskySellers: number;
    averageVariantConfidence: number; averageUrgency: number; frontierTotal: number;
    frontierActive: number; frontierBlocked: number; duplicatesAvoided: number;
    inspectionsRequested: number; inspectionsCompleted: number;
  };
};

type BudgetRecommendation = {
  id: string;
  currentBudget: number;
  recommendedBudget: number;
  yieldPerThousand: number;
  exploitablePerEuro: number | null;
  action: "increase" | "hold" | "decrease";
  reason: string;
};

type PublicMeasurement = {
  status: "measured" | "insufficient_sample" | "unavailable" | "incomplete_data";
  value: number | null;
  unit: "percent" | "minutes";
  sampleSize: number;
  minimumSampleSize: number;
};

type PublicQuality = {
  generatedAt: string;
  reliability: {
    status: "measured" | "insufficient_sample" | "incomplete_data";
    sample: { alerts: number; assessedAlerts: number };
    metrics: {
      usefulAlertRate: PublicMeasurement;
      falsePositiveRate: PublicMeasurement;
      totalPriceKnownRate: PublicMeasurement;
      doubleVerificationRate: PublicMeasurement;
      notificationLatencyMedian: PublicMeasurement;
    };
  };
};

type PublicIntegrity = {
  status: string;
  index: { status: string; score: number | null; sampleSize: number; minimumSampleSize: number; label: string };
  items: Array<{
    alertId: string;
    source: string;
    merchant: string;
    market: string;
    title: string;
    score: number | null;
    label: string;
    status: string;
  }>;
};

type CoverageItem = {
  source: string;
  displayName: string;
  market: string;
  status: "active" | "partner_required" | "planned";
  registryStatus: "active" | "partner_required" | "planned";
  effectiveStatus: "planned" | "locked" | "authorized_unverified" | "active" | "degraded" | "code_ready";
  partnerAuthorized: boolean;
  liveStatus: string | null;
  lastSuccessAt: string | null;
  adapterVersion: string;
  verification: string;
  configuredSegments: number;
  calibratedSegments: number;
  uncalibratedSegments: number;
  enabledSegments: number;
  categories: number;
  estimatedProducts: number | null;
  uniqueProductsSeen: number;
  estimatedCoveragePercent: number | null;
  contractStatus: "unconfigured" | "passing" | "degraded" | "failing";
  frontier: { total: number; queued: number; blocked: number };
  lastSevenDays: { productsSeen: number; antiBotBlocks: number };
};

const DEFAULT_METRICS: Metrics = {
  productsSeen: 0, antiBotBlocks: 0, keepaRequests: 0, apifyCostEuros: 0, keepaEstimatedCostEuros: 0,
  costPerExploitableAlertEuros: null, exploitableAlerts: 0, alertsInReview: 0,
  conditionalPrices: 0, feedback: { total: 0, useful: 0, falsePositive: 0, expired: 0 },
  autonomy: { analyzed: 0, cartsConfirmed: 0, trueAnomalies: 0, riskySellers: 0, averageVariantConfidence: 0, averageUrgency: 0, frontierTotal: 0, frontierActive: 0, frontierBlocked: 0, duplicatesAvoided: 0, inspectionsRequested: 0, inspectionsCompleted: 0 },
};
const DEFAULT_GRAPH_METRICS = { canonicalProducts: 0, merchantMappings: 0, pendingReviews: 0 };

export function AdminView() {
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [segments, setSegments] = useState<DiscoverySegment[]>([]);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [graphMetrics, setGraphMetrics] = useState(DEFAULT_GRAPH_METRICS);
  const [budgetRecommendations, setBudgetRecommendations] = useState<BudgetRecommendation[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unauthorized" | "unconfigured" | "error">("loading");
  const [publicQuality, setPublicQuality] = useState<PublicQuality | null>(null);
  const [publicIntegrity, setPublicIntegrity] = useState<PublicIntegrity | null>(null);
  const [coverage, setCoverage] = useState<CoverageItem[]>([]);
  const [publicDataState, setPublicDataState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const responses = await Promise.all([
        fetch("/api/admin/overview", { headers: { accept: "application/json" } }),
        fetch("/api/admin/sources", { headers: { accept: "application/json" } }),
        fetch("/api/admin/discovery", { headers: { accept: "application/json" } }),
        fetch("/api/admin/products", { headers: { accept: "application/json" } }),
        fetch("/api/admin/coverage", { headers: { accept: "application/json" } }),
      ]);
      if (responses.some((response) => response.status === 401)) return setState("unauthorized");
      if (responses.some((response) => response.status === 503)) return setState("unconfigured");
      if (responses.some((response) => !response.ok)) throw new Error("pilotage");
      const [overview, sourceData, discoveryData, productData, coverageData] = await Promise.all(responses.map((response) => response.json())) as [
        { metrics?: Metrics; budgetRecommendations?: BudgetRecommendation[] },
        { items?: SourceConfig[] },
        { items?: DiscoverySegment[] },
        { metrics?: typeof graphMetrics; pending?: ProductReview[] },
        { items?: CoverageItem[] },
      ];
      setMetrics(overview.metrics ?? DEFAULT_METRICS);
      setBudgetRecommendations(overview.budgetRecommendations ?? []);
      setSources(sourceData.items ?? []);
      setSegments(discoveryData.items ?? []);
      setGraphMetrics(productData.metrics ?? DEFAULT_GRAPH_METRICS);
      setReviews(productData.pending ?? []);
      setCoverage(coverageData.items ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      fetch("/api/public/metrics", { headers: { accept: "application/json" } }).then(async (response) => {
        if (!response.ok) throw new Error("metrics");
        const payload = await response.json() as { ok?: boolean } & PublicQuality;
        if (payload.ok !== true || !payload.reliability?.metrics) throw new Error("metrics");
        return payload;
      }),
      fetch("/api/integrity", { headers: { accept: "application/json" } }).then(async (response) => {
        if (!response.ok) throw new Error("integrity");
        const payload = await response.json() as { ok?: boolean } & PublicIntegrity;
        if (payload.ok !== true || !Array.isArray(payload.items)) throw new Error("integrity");
        return payload;
      }),
    ]).then(([qualityResult, integrityResult]) => {
      if (!active) return;
      if (qualityResult.status === "fulfilled") setPublicQuality(qualityResult.value);
      if (integrityResult.status === "fulfilled") setPublicIntegrity(integrityResult.value);
      setPublicDataState(qualityResult.status === "fulfilled" || integrityResult.status === "fulfilled" ? "ready" : "unavailable");
    });
    return () => { active = false; };
  }, []);

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const source = String(data.get("source") ?? "boulanger");
    const response = await fetch("/api/admin/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source,
        market: source === "amazon" ? String(data.get("market") ?? "FR") : "FR",
        displayName: String(data.get("displayName") ?? source),
        category: String(data.get("category") ?? "Général"),
        discoveryStrategy: String(data.get("discoveryStrategy") ?? "links"),
        estimatedProductCount: data.get("estimatedProductCount") ? Number(data.get("estimatedProductCount")) : null,
        discoveryUrl: String(data.get("discoveryUrl") ?? ""),
        cadenceMinutes: Number(data.get("cadenceMinutes") ?? 60),
        dailyProductBudget: Number(data.get("dailyProductBudget") ?? 500),
      }),
    });
    const payload = await response.json() as { error?: string };
    setMessage(response.ok ? "Page de couverture ajoutée." : payload.error ?? "Ajout impossible.");
    if (response.ok) { form.reset(); await refresh(); }
  }

  async function patchSource(id: string, patch: Record<string, unknown>, success: string) {
    const response = await fetch("/api/admin/sources", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    setMessage(response.ok ? success : "Modification impossible.");
    if (response.ok) await refresh();
  }

  async function seedDiscovery() {
    const response = await fetch("/api/admin/discovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "seedDefaults" }),
    });
    setMessage(response.ok ? "Rotation Amazon EU5 initialisée avec des budgets prudents." : "Initialisation impossible.");
    if (response.ok) await refresh();
  }

  async function toggleSegment(segment: DiscoverySegment) {
    const response = await fetch("/api/admin/discovery", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: segment.id, enabled: !segment.enabled }),
    });
    setMessage(response.ok ? "Stratégie Amazon mise à jour." : "Modification impossible.");
    if (response.ok) await refresh();
  }

  async function reviewProduct(id: string, action: "confirm" | "reject") {
    const response = await fetch("/api/admin/products", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    setMessage(response.ok ? "Rapprochement produit enregistré." : "Décision impossible.");
    if (response.ok) await refresh();
  }

  if (state === "unauthorized") {
    return <section className="admin-empty"><h1>Accès administrateur requis</h1><p>Le radar public reste ouvert. Le pilotage est protégé séparément par Cloudflare Access.</p><a className="primary-button" href="/cdn-cgi/access/login?redirect_url=%2F">Ouvrir l’accès sécurisé</a></section>;
  }
  if (state === "unconfigured") return <section className="admin-empty"><h1>Pilotage à finaliser</h1><p>La base D1 ou la protection Cloudflare Access attend encore sa configuration de production.</p><button className="secondary-button" onClick={() => void refresh()}>Réessayer</button></section>;
  if (state === "error") return <section className="admin-empty"><h1>Pilotage indisponible</h1><p>Les contrôles n’ont pas pu être chargés.</p><button className="secondary-button" onClick={() => void refresh()}>Réessayer</button></section>;

  const falsePositiveRate = metrics.feedback.total > 0 ? Math.round((metrics.feedback.falsePositive / metrics.feedback.total) * 100) : 0;
  const budgetById = new Map(budgetRecommendations.map((item) => [item.id, item]));
  const publicMetricEntries: Array<[string, PublicMeasurement]> = publicQuality ? [
    ["Alertes jugées utiles", publicQuality.reliability.metrics.usefulAlertRate],
    ["Faux positifs", publicQuality.reliability.metrics.falsePositiveRate],
    ["Total livré connu", publicQuality.reliability.metrics.totalPriceKnownRate],
    ["Double vérification", publicQuality.reliability.metrics.doubleVerificationRate],
    ["Délai médian", publicQuality.reliability.metrics.notificationLatencyMedian],
  ] : [];
  const measuredPublicMetrics = publicMetricEntries.filter((entry) => entry[1].status === "measured" && entry[1].value !== null);
  return (
    <section className="view-section">
      <div className="page-heading"><div><span className="eyebrow">Administration · production Cloudflare</span><h1>Centre de pilotage</h1><p>Couverture, budgets, coupe-circuits et qualité du référentiel produit.</p></div><button className="secondary-button" onClick={() => void refresh()}>Actualiser</button></div>
      <div className="metric-row admin-metrics">
        <div className="metric-card metric-primary"><span>Produits analysés</span><strong>{state === "loading" ? "…" : metrics.productsSeen}</strong><small>{metrics.exploitableAlerts} alertes exploitables</small></div>
        <div className="metric-card"><span>Keepa / Apify</span><strong>{metrics.keepaRequests} req. / {metrics.apifyCostEuros.toFixed(2)} €</strong><small>{metrics.keepaEstimatedCostEuros.toFixed(2)} € Keepa · {metrics.costPerExploitableAlertEuros === null ? "coût/alerte en attente" : `${metrics.costPerExploitableAlertEuros.toFixed(2)} € par alerte`}</small></div>
        <div className="metric-card"><span>Qualité</span><strong>{falsePositiveRate} %</strong><small>{metrics.antiBotBlocks} blocages · {graphMetrics.pendingReviews} rapprochements à revoir</small></div>
      </div>

      <section className="admin-panel public-governance-panel">
        <div className="section-label-row"><div><span className="eyebrow">Publication vérifiable</span><h2>Ce que le public voit vraiment</h2></div>{publicQuality?.generatedAt ? <span>{new Date(publicQuality.generatedAt).toLocaleDateString("fr-FR")}</span> : null}</div>
        {publicDataState === "loading" ? <p className="admin-muted">Chargement des indicateurs publics…</p> : publicDataState === "unavailable" ? <p className="admin-muted is-warning">Les endpoints publics sont indisponibles. Aucun indicateur de remplacement n’est affiché.</p> : <>
          <div className="public-governance-metrics">
            {measuredPublicMetrics.map(([label, measurement]) => <div key={label}><span>{label}</span><strong>{measurement.value?.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}{measurement.unit === "minutes" ? " min" : " %"}</strong><small>{measurement.sampleSize} mesures</small></div>)}
          </div>
          {measuredPublicMetrics.length === 0 ? <p className="admin-muted">L’échantillon public est encore insuffisant : aucun taux de remplacement n’est inventé.</p> : null}
          {publicIntegrity ? <div className="public-integrity-admin-list"><div><span><strong>Indice global de sincérité</strong><small>{publicIntegrity.index.sampleSize} offres mesurables · minimum {publicIntegrity.index.minimumSampleSize}</small></span>{publicIntegrity.index.score === null ? <em>Données insuffisantes</em> : <strong>{publicIntegrity.index.score.toLocaleString("fr-FR")}/100</strong>}</div>{publicIntegrity.items.slice(0, 5).map((item) => <div key={item.alertId}><span><strong>{item.merchant || item.source}</strong><small>{item.market} · {item.title}</small></span>{item.score === null ? <em>{item.label}</em> : <strong>{item.score.toLocaleString("fr-FR")}/100</strong>}</div>)}</div> : <p className="admin-muted">Aucun indice d’intégrité publiable pour le moment.</p>}
          <a className="secondary-button" href="/transparence">Ouvrir la page publique</a>
        </>}
      </section>

      <section className="admin-panel">
        <div className="section-label-row"><div><span className="eyebrow">Registre versionné</span><h2>Couverture mesurée par connecteur</h2></div><span>{coverage.filter((item) => item.effectiveStatus === "active").length} actifs · {coverage.filter((item) => item.effectiveStatus === "locked").length} accès requis · {coverage.filter((item) => item.effectiveStatus === "authorized_unverified").length} en recette · {coverage.filter((item) => item.effectiveStatus === "planned").length} prévus</span></div>
        <p className="admin-muted">Le pourcentage porte uniquement sur les segments dont la taille de catalogue est renseignée. Les mêmes produits vus sur plusieurs pages ne sont comptés qu’une fois.</p>
        <div className="admin-source-list">{coverage.map((item) => {
          const effectiveLabel = item.effectiveStatus === "active" ? "Actif" : item.effectiveStatus === "locked" ? "Accès requis" : item.effectiveStatus === "authorized_unverified" ? "Autorisé · recette" : item.effectiveStatus === "degraded" ? "Dégradé" : item.effectiveStatus === "planned" ? "Prévu" : "Prêt";
          const effectiveTone = item.effectiveStatus === "active" ? "live" : item.effectiveStatus === "planned" ? "planned" : item.effectiveStatus === "code_ready" ? "prepared" : "warning";
          const statusDetail = item.effectiveStatus === "locked" ? "Connecteur prêt · autorisation ou flux partenaire requis" : item.effectiveStatus === "authorized_unverified" ? "Accès enregistré · premier rapport LIVE sain requis" : item.effectiveStatus === "active" ? `Rapport LIVE sain${item.lastSuccessAt ? ` · ${new Date(item.lastSuccessAt).toLocaleString("fr-FR")}` : ""}` : item.effectiveStatus === "degraded" ? `Accès enregistré · santé ${item.liveStatus ?? "à contrôler"}` : item.effectiveStatus === "planned" ? "Planifié" : item.estimatedCoveragePercent === null ? "Couverture à calibrer" : `${item.estimatedCoveragePercent} % des segments calibrés`;
          return <div className="admin-source-row" key={`${item.source}:${item.market}`}><div><strong>{item.displayName} · {item.market}</strong><small>Adaptateur {item.adapterVersion} · {item.configuredSegments} segments ({item.calibratedSegments} calibrés) · {item.categories} catégories</small><em className={item.effectiveStatus === "active" && item.contractStatus === "passing" && item.uncalibratedSegments === 0 ? "" : "is-warning"}>{statusDetail} · contrat {item.contractStatus} · {item.frontier.queued} URL en file</em></div><span className={`source-status status-${effectiveTone}`}><i />{effectiveLabel}</span></div>;
        })}</div>
      </section>

      <section className="admin-panel autonomy-admin-panel">
        <div className="section-label-row"><div><span className="eyebrow">Moteur autonome</span><h2>Qualité avant notification</h2></div><span>7 derniers jours</span></div>
        <div className="autonomy-admin-grid">
          <div><span>Panier fantôme</span><strong>{metrics.autonomy.cartsConfirmed}/{metrics.autonomy.analyzed}</strong><small>totaux finaux confirmés</small></div>
          <div><span>Variante exacte</span><strong>{metrics.autonomy.averageVariantConfidence}/100</strong><small>confiance moyenne</small></div>
          <div><span>Origine</span><strong>{metrics.autonomy.trueAnomalies}</strong><small>anomalies réelles · {metrics.autonomy.riskySellers} vendeurs risqués</small></div>
          <div><span>Sentinelle</span><strong>{metrics.autonomy.frontierActive}/{metrics.autonomy.frontierTotal}</strong><small>URL actives · {metrics.autonomy.duplicatesAvoided} doublons évités</small></div>
          <div><span>Partages PWA</span><strong>{metrics.autonomy.inspectionsCompleted}/{metrics.autonomy.inspectionsRequested}</strong><small>inspections terminées</small></div>
          <div><span>Urgence</span><strong>{metrics.autonomy.averageUrgency}/100</strong><small>durée d’opportunité estimée</small></div>
        </div>
      </section>

      <div className="admin-grid">
        <div className="admin-panel">
          <div className="section-label-row"><h2>Couverture et coupe-circuits</h2><span>{sources.length} pages</span></div>
          <div className="admin-source-list">
            {sources.map((source) => {
              const underExplored = source.productsSeen < 5 || source.lastRunAt === null;
              const open = source.circuitState !== "closed";
              const budget = budgetById.get(source.id);
              return <div className="admin-source-row" key={source.id}><div><strong>{source.displayName} · {source.category}</strong><small>{source.market} · {source.discoveryStrategy} · {source.cadenceMinutes} min · budget {source.dailyProductBudget}/jour{budget ? ` → ${budget.recommendedBudget} conseillé` : ""}</small><em className={open || underExplored || source.contractStatus !== "passing" ? "is-warning" : ""}>{open ? `Circuit ${source.circuitState} · ${source.pausedReason ?? "incident"}` : underExplored ? "Peu explorée" : `${source.uniqueProductsSeen || source.productsSeen} produits uniques`} · {source.estimatedProductCount ? `${source.coveragePercent ?? 0} % de ${source.estimatedProductCount} estimés` : "catalogue à calibrer"} · contrat {source.contractStatus} · {source.duplicateUrls} doublons évités{budget ? ` · rendement ${budget.yieldPerThousand}/1 000` : ""}</em>{budget && budget.action !== "hold" ? <small>{budget.reason}</small> : null}</div><div className="admin-row-actions">{open ? <button className="secondary-button" onClick={() => void patchSource(source.id, { resetCircuit: true }, "Circuit réarmé.")}>Réarmer</button> : null}<button className={source.enabled ? "danger-button" : "secondary-button"} onClick={() => void patchSource(source.id, { enabled: !source.enabled }, source.enabled ? "Enseigne suspendue." : "Enseigne activée.")}>{source.enabled ? "Suspendre" : "Activer"}</button></div></div>;
            })}
            {state === "ready" && sources.length === 0 ? <p className="admin-muted">Ajoutez une première page catégorie ci-dessous.</p> : null}
          </div>
        </div>

        <form className="admin-panel admin-form" onSubmit={addSource}>
          <div><span className="eyebrow">Sans changement de code</span><h2>Ajouter une page catégorie</h2></div>
          <label>Enseigne<select name="source" defaultValue="boulanger"><option value="boulanger">Boulanger</option><option value="darty">Darty</option><option value="cdiscount">Cdiscount</option><option value="fnac">Fnac</option><option value="carrefour">Carrefour</option><option value="leroy_merlin">Leroy Merlin</option><option value="castorama">Castorama</option><option value="conforama">Conforama</option><option value="rueducommerce">Rue du Commerce</option><option value="amazon">Amazon</option></select></label>
          <div className="admin-form-pair"><label>Marché<select name="market" defaultValue="FR"><option>FR</option><option>DE</option><option>IT</option><option>ES</option><option>GB</option></select></label><label>Cadence<select name="cadenceMinutes" defaultValue="60"><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 h</option><option value="240">4 h</option><option value="1440">24 h</option></select></label></div>
          <label>Nom<input name="displayName" required maxLength={120} placeholder="Boulanger TV" /></label>
          <label>Catégorie<input name="category" required maxLength={80} placeholder="Image & son" /></label>
          <div className="admin-form-pair"><label>Découverte<select name="discoveryStrategy" defaultValue="links"><option value="links">Liens de page · actif</option><option value="sitemap" disabled>Sitemap · bientôt</option><option value="feed" disabled>Flux partenaire · bientôt</option><option value="api" disabled>API partenaire · bientôt</option></select></label><label>Taille catalogue estimée<input name="estimatedProductCount" type="number" min="1" max="100000000" placeholder="ex. 2400" /></label></div>
          <label>Budget produits / jour<input name="dailyProductBudget" type="number" min="1" max="100000" defaultValue="500" /></label>
          <label>URL HTTPS<input name="discoveryUrl" type="url" required placeholder="https://www.enseigne.fr/categorie" /></label>
          <p className="admin-muted">Ajouter une page prépare la couverture, sans déclarer l’enseigne active. Fnac, Carrefour, Leroy Merlin, Castorama, Conforama et Rue du Commerce nécessitent encore une autorisation de collecte ou un flux partenaire ; le statut LIVE exige ensuite un rapport sain récent.</p>
          <button className="primary-button" type="submit">Ajouter à la couverture</button>
        </form>
      </div>

      <div className="admin-subgrid">
        <section className="admin-panel">
          <div className="section-label-row"><div><span className="eyebrow">Amazon EU5</span><h2>Découverte sous budget</h2></div>{segments.length === 0 ? <button className="primary-button" onClick={() => void seedDiscovery()}>Initialiser EU5</button> : <span>{segments.length} segments</span>}</div>
          <p className="admin-muted">Les gammes de prix tournent par marché. Chaque segment reçoit une enveloppe quotidienne et change de page automatiquement.</p>
          <div className="admin-source-list">{segments.slice(0, 15).map((segment) => <div className="admin-source-row" key={segment.id}><div><strong>{segment.market} · {segment.label}</strong><small>{segment.dailyTokenBudget} unités/jour · priorité {segment.priority} · toutes les {segment.cadenceMinutes} min</small></div><button className={segment.enabled ? "danger-button" : "secondary-button"} onClick={() => void toggleSegment(segment)}>{segment.enabled ? "Suspendre" : "Activer"}</button></div>)}</div>
        </section>

        <section className="admin-panel">
          <div className="section-label-row"><div><span className="eyebrow">Graphe produit</span><h2>Rapprochements marchands</h2></div><span>{graphMetrics.canonicalProducts} produits · {graphMetrics.merchantMappings} références</span></div>
          {reviews.length === 0 ? <p className="admin-muted">Aucun rapprochement incertain à traiter.</p> : <div className="admin-review-list">{reviews.slice(0, 8).map((review) => <article key={review.id}><div><strong>{review.title}</strong><small>{review.source} {review.market} · {review.brand ?? "marque inconnue"} · {review.model ?? review.externalId}</small><em>Score {review.matchScore}/100 · méthode {review.matchMethod}</em></div><div className="admin-row-actions"><button className="secondary-button" onClick={() => void reviewProduct(review.id, "confirm")}>Confirmer</button><button className="danger-button" onClick={() => void reviewProduct(review.id, "reject")}>Séparer</button></div></article>)}</div>}
        </section>
      </div>
      {message ? <p className="admin-message" role="status">{message}</p> : null}
      <div className="trust-note"><span>✓</span><div><strong>Protection active par défaut</strong><p>Trois échecs ou deux blocages anti-bot ouvrent le circuit. Une sonde unique est autorisée après le délai, puis la source se réactive seulement si elle réussit.</p></div></div>
    </section>
  );
}
