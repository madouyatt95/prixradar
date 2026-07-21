export type BudgetPerformance = {
  id: string;
  currentBudget: number;
  productsSeen: number;
  exploitableAlerts: number;
  costMicros: number;
  antiBotBlocks: number;
};

export type BudgetRecommendation = BudgetPerformance & {
  yieldPerThousand: number;
  exploitablePerEuro: number | null;
  recommendedBudget: number;
  action: "increase" | "hold" | "decrease";
  reason: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function optimizeCoverageBudgets(rows: BudgetPerformance[]): BudgetRecommendation[] {
  return rows.map((row) => {
    const yieldPerThousand = row.productsSeen > 0 ? (row.exploitableAlerts / row.productsSeen) * 1_000 : 0;
    const exploitablePerEuro = row.costMicros > 0 ? row.exploitableAlerts / (row.costMicros / 1_000_000) : null;
    const blocked = row.antiBotBlocks >= 2;
    const multiplier = blocked ? 0.7 : yieldPerThousand >= 10 ? 1.25 : yieldPerThousand === 0 && row.productsSeen >= 100 ? 0.8 : 1;
    const recommendedBudget = Math.round(clamp(row.currentBudget * multiplier, Math.max(10, row.currentBudget * 0.5), row.currentBudget * 1.5));
    const action = recommendedBudget > row.currentBudget ? "increase" as const : recommendedBudget < row.currentBudget ? "decrease" as const : "hold" as const;
    return {
      ...row,
      yieldPerThousand: Math.round(yieldPerThousand * 10) / 10,
      exploitablePerEuro: exploitablePerEuro === null ? null : Math.round(exploitablePerEuro * 10) / 10,
      recommendedBudget,
      action,
      reason: blocked
        ? "Réduire la pression après blocages anti-bot"
        : action === "increase"
          ? "Renforcer une couverture à fort rendement"
          : action === "decrease"
            ? "Conserver un budget d’exploration minimal"
            : "Échantillon insuffisant ou rendement stable",
    };
  });
}
