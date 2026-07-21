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

export function AdminView() {
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unauthorized" | "error">("loading");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [overviewResponse, sourcesResponse] = await Promise.all([
        fetch("/api/admin/overview", { headers: { accept: "application/json" } }),
        fetch("/api/admin/sources", { headers: { accept: "application/json" } }),
      ]);
      if (overviewResponse.status === 401 || sourcesResponse.status === 401) return setState("unauthorized");
      if (!overviewResponse.ok || !sourcesResponse.ok) throw new Error("pilotage");
      const overview = await overviewResponse.json() as { metrics?: Metrics };
      const sourceData = await sourcesResponse.json() as { items?: SourceConfig[] };
      setMetrics(overview.metrics ?? DEFAULT_METRICS);
      setSources(sourceData.items ?? []);
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
    const data = new FormData(event.currentTarget);
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
      }),
    });
    const payload = await response.json() as { error?: string };
    setMessage(response.ok ? "Page de couverture ajoutée." : payload.error ?? "Ajout impossible.");
    if (response.ok) { event.currentTarget.reset(); await refresh(); }
  }

  async function updateSource(id: string, enabled: boolean) {
    const response = await fetch("/api/admin/sources", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    setMessage(response.ok ? (enabled ? "Enseigne activée." : "Enseigne suspendue.") : "Modification impossible.");
    if (response.ok) await refresh();
  }

  if (state === "unauthorized") {
    return <section className="admin-empty"><h1>Connexion administrateur requise</h1><p>Le centre de pilotage contient les coûts et les contrôles des sources.</p><a className="primary-button" href="/signin-with-chatgpt?return_to=/">Se connecter avec ChatGPT</a></section>;
  }
  if (state === "error") return <section className="admin-empty"><h1>Pilotage indisponible</h1><p>Appliquez la migration D1, puis réessayez.</p><button className="secondary-button" onClick={() => void refresh()}>Réessayer</button></section>;

  const falsePositiveRate = metrics.feedback.total > 0 ? Math.round((metrics.feedback.falsePositive / metrics.feedback.total) * 100) : 0;
  return (
    <section className="view-section">
      <div className="page-heading"><div><span className="eyebrow">Administration · 7 derniers jours</span><h1>Centre de pilotage</h1><p>Couverture, consommation, qualité des alertes et activation des enseignes.</p></div><button className="secondary-button" onClick={() => void refresh()}>Actualiser</button></div>
      <div className="metric-row admin-metrics">
        <div className="metric-card metric-primary"><span>Produits analysés</span><strong>{state === "loading" ? "…" : metrics.productsSeen}</strong><small>{metrics.exploitableAlerts} alertes exploitables</small></div>
        <div className="metric-card"><span>Keepa / Apify</span><strong>{metrics.keepaRequests} req. / {metrics.apifyCostEuros.toFixed(2)} €</strong><small>{metrics.keepaEstimatedCostEuros.toFixed(2)} € Keepa ventilés · {metrics.costPerExploitableAlertEuros === null ? "coût/alerte en attente" : `${metrics.costPerExploitableAlertEuros.toFixed(2)} € par alerte`}</small></div>
        <div className="metric-card"><span>Qualité</span><strong>{falsePositiveRate} %</strong><small>{metrics.antiBotBlocks} blocages · vie moy. {metrics.feedback.averageLifetimeMinutes ?? 0} min</small></div>
      </div>

      <div className="admin-grid">
        <div className="admin-panel">
          <div className="section-label-row"><h2>Couverture pilotée</h2><span>{sources.length} pages</span></div>
          <div className="admin-source-list">
            {sources.map((source) => {
              const underExplored = source.productsSeen < 5 || source.lastRunAt === null;
              return <div className="admin-source-row" key={source.id}><div><strong>{source.displayName} · {source.category}</strong><small>{source.market} · toutes les {source.cadenceMinutes} min · volatilité {source.volatilityScore}/100</small><em className={underExplored ? "is-warning" : ""}>{underExplored ? "Peu explorée" : `${source.productsSeen} produits`} · {source.duplicateUrls} doublons évités</em></div><button className={source.enabled ? "danger-button" : "secondary-button"} onClick={() => void updateSource(source.id, !source.enabled)}>{source.enabled ? "Suspendre" : "Activer"}</button></div>;
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
          <label>URL HTTPS<input name="discoveryUrl" type="url" required placeholder="https://www.boulanger.com/c/television" /></label>
          <button className="primary-button" type="submit">Ajouter à la couverture</button>
          {message ? <p className="admin-message" role="status">{message}</p> : null}
        </form>
      </div>
      <div className="trust-note"><span>✓</span><div><strong>Fréquence adaptative active</strong><p>Les catégories volatiles passent jusqu’à deux fois plus souvent, les stables jusqu’à deux fois moins souvent. Les URL normalisées sont dédupliquées avant collecte.</p></div></div>
    </section>
  );
}
