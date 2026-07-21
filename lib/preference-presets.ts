export type ExperienceLevel = "essential" | "expert";
export type PreferencePresetId = "safe" | "balanced" | "fast";

export const PREFERENCE_PRESETS = {
  safe: {
    id: "safe",
    label: "Fiable",
    summary: "Très peu d’alertes, uniquement avec les preuves les plus solides.",
    values: {
      minScore: 85,
      minDiscount: 25,
      minSellerScore: 85,
      requireExactVariant: true,
      requireCartConfirmation: true,
      maxAlertAgeMinutes: 30,
      minimumHistoryPoints: 10,
      closeExpiredMinutes: 5,
      notificationSpeed: "balanced" as const,
    },
  },
  balanced: {
    id: "balanced",
    label: "Équilibré",
    summary: "Le meilleur compromis entre rapidité, couverture et sécurité.",
    values: {
      minScore: 75,
      minDiscount: 20,
      minSellerScore: 70,
      requireExactVariant: true,
      requireCartConfirmation: true,
      maxAlertAgeMinutes: 60,
      minimumHistoryPoints: 5,
      closeExpiredMinutes: 10,
      notificationSpeed: "balanced" as const,
    },
  },
  fast: {
    id: "fast",
    label: "Rapide",
    summary: "Plus de signaux et plus tôt, avec davantage de vérifications à faire soi-même.",
    values: {
      minScore: 65,
      minDiscount: 15,
      minSellerScore: 60,
      requireExactVariant: true,
      requireCartConfirmation: false,
      maxAlertAgeMinutes: 90,
      minimumHistoryPoints: 3,
      closeExpiredMinutes: 15,
      notificationSpeed: "instant" as const,
    },
  },
} as const satisfies Record<PreferencePresetId, {
  id: PreferencePresetId;
  label: string;
  summary: string;
  values: {
    minScore: number;
    minDiscount: number;
    minSellerScore: number;
    requireExactVariant: boolean;
    requireCartConfirmation: boolean;
    maxAlertAgeMinutes: number;
    minimumHistoryPoints: number;
    closeExpiredMinutes: number;
    notificationSpeed: "instant" | "balanced" | "digest";
  };
}>;

export function preferencePreset(id: PreferencePresetId) {
  return PREFERENCE_PRESETS[id];
}

export function publicPreferencePresets() {
  return Object.values(PREFERENCE_PRESETS).map(({ id, label, summary, values }) => ({ id, label, summary, values }));
}
