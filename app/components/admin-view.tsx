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
};

const DEFAULT_METRICS: Metrics = {
  productsSeen: 0, antiBotBlocks: 0, keepaRequests: 0, apifyCostEuros: 0, keepaEstimatedCostEuros: 0,
  costPerExploitableAlertEuros: null, exploitableAlerts: 0, alertsInReview: 0,
  conditionalPrices: 0, feedback: { total: 0, useful: 0, falsePositive: 0, expired: 0 },
};
const DEFAULT_GRAPH_METRICS = { canonicalProducts: 0, merchantMappings: 0, pendingReviews: 0 };

export function AdminView() {
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [segments, setSegments] = useState<DiscoverySegment[]>([]);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [graphMetrics, setGraphMetrics] = useState(DEFAULT_GRAPH_METRICS);
  const [state, setState] = useState<"loading" | "ready" | "unauthorized" | "unconfigured" | "error">("loading");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const responses = await Promise.all([
        fetch("/api/admin/overview", { headers: { accept: "application/json" } }),
        fetch("/api/admin/sources", { headers: { accept: "application/json" } }),
        fetch("/api/admin/discovery", { headers: { accept: "application/json" } }),
        fetch("/api/admin/products", { headers: { accept: "application/json" } }),
      ]);
      if (responses.some((response) => response.status === 401)) return setState("unauthorized");
      if (responses.some((response) => response.status === 503)) return setState("unconfigured");
      if (responses.some((response) => !response.ok)) throw new Error("pilotage");
      const [overview, sourceData, discoveryData, productData] = await Promise.all(responses.map((response) => response.json())) as [
        { metrics?: Metrics },
        { items?: SourceConfig[] },
        { items?: DiscoverySegment[] },
        { metrics?: typeof graphMetrics; pending?: ProductReview[] },
      ];
      setMetrics(overview.metrics ?? DEFAULT_METRICS);
      setSources(sourceData.items ?? []);
      setSegments(discoveryData.items ?? []);
      setGraphMetrics(productData.metrics ?? DEFAULT_GRAPH_METRICS);
      setReviews(productData.pending ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

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
  return (
    <section className="view-section">
      <div className="page-heading"><div><span className="eyebrow">Administration · production Cloudflare</span><h1>Centre de pilotage</h1><p>Couverture, budgets, coupe-circuits et qualité du référentiel produit.</p></div><button className="secondary-button" onClick={() => void refresh()}>Actualiser</button></div>
      <div className="metric-row admin-metrics">
        <div className="metric-card metric-primary"><span>Produits analysés</span><strong>{state === "loading" ? "…" : metrics.productsSeen}</strong><small>{metrics.exploitableAlerts} alertes exploitables</small></div>
        <div className="metric-card"><span>Keepa / Apify</span><strong>{metrics.keepaRequests} req. / {metrics.apifyCostEuros.toFixed(2)} €</strong><small>{metrics.keepaEstimatedCostEuros.toFixed(2)} € Keepa · {metrics.costPerExploitableAlertEuros === null ? "coût/alerte en attente" : `${metrics.costPerExploitableAlertEuros.toFixed(2)} € par alerte`}</small></div>
        <div className="metric-card"><span>Qualité</span><strong>{falsePositiveRate} %</strong><small>{metrics.antiBotBlocks} blocages · {graphMetrics.pendingReviews} rapprochements à revoir</small></div>
      </div>

      <div className="admin-grid">
        <div className="admin-panel">
          <div className="section-label-row"><h2>Couverture et coupe-circuits</h2><span>{sources.length} pages</span></div>
          <div className="admin-source-list">
            {sources.map((source) => {
              const underExplored = source.productsSeen < 5 || source.lastRunAt === null;
              const open = source.circuitState !== "closed";
              return <div className="admin-source-row" key={source.id}><div><strong>{source.displayName} · {source.category}</strong><small>{source.market} · {source.cadenceMinutes} min · budget {source.dailyProductBudget}/jour</small><em className={open || underExplored ? "is-warning" : ""}>{open ? `Circuit ${source.circuitState} · ${source.pausedReason ?? "incident"}` : underExplored ? "Peu explorée" : `${source.productsSeen} produits`} · {source.duplicateUrls} doublons évités</em></div><div className="admin-row-actions">{open ? <button className="secondary-button" onClick={() => void patchSource(source.id, { resetCircuit: true }, "Circuit réarmé.")}>Réarmer</button> : null}<button className={source.enabled ? "danger-button" : "secondary-button"} onClick={() => void patchSource(source.id, { enabled: !source.enabled }, source.enabled ? "Enseigne suspendue." : "Enseigne activée.")}>{source.enabled ? "Suspendre" : "Activer"}</button></div></div>;
            })}
            {state === "ready" && sources.length === 0 ? <p className="admin-muted">Ajoutez une première page catégorie ci-dessous.</p> : null}
          </div>
        </div>

        <form className="admin-panel admin-form" onSubmit={addSource}>
          <div><span className="eyebrow">Sans changement de code</span><h2>Ajouter une page catégorie</h2></div>
          <label>Enseigne<select name="source" defaultValue="boulanger"><option value="boulanger">Boulanger</option><option value="darty">Darty</option><option value="cdiscount">Cdiscount</option><option value="amazon">Amazon</option></select></label>
          <div className="admin-form-pair"><label>Marché<select name="market" defaultValue="FR"><option>FR</option><option>DE</option><option>IT</option><option>ES</option><option>GB</option></select></label><label>Cadence<select name="cadenceMinutes" defaultValue="60"><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 h</option><option value="240">4 h</option><option value="1440">24 h</option></select></label></div>
          <label>Nom<input name="displayName" required maxLength={120} placeholder="Boulanger TV" /></label>
          <label>Catégorie<input name="category" required maxLength={80} placeholder="Image & son" /></label>
          <label>Budget produits / jour<input name="dailyProductBudget" type="number" min="1" max="100000" defaultValue="500" /></label>
          <label>URL HTTPS<input name="discoveryUrl" type="url" required placeholder="https://www.boulanger.com/c/television" /></label>
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
