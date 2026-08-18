import { ScheduleActions, type ScheduleCreateOrUpdateData } from "apify-client";

export interface AutomationSchedule {
  name: string;
  definition: ScheduleCreateOrUpdateData;
}

function actorAction(actorId: string, input: Record<string, unknown>, memoryMbytes: number) {
  return {
    type: ScheduleActions.RunActor,
    actorId,
    runInput: {
      body: JSON.stringify(input),
      contentType: "application/json; charset=utf-8",
    },
    runOptions: {
      build: "latest",
      timeoutSecs: 900,
      memoryMbytes,
      restartOnError: false,
    },
  } as const;
}

export function buildAutomationPlan(actorId: string, retailUrls: readonly string[]): AutomationSchedule[] {
  const common = {
    timezone: "Europe/Paris" as const,
    isEnabled: true,
    isExclusive: true,
    notifications: { email: true },
  };
  const schedules: AutomationSchedule[] = [{
    name: "prixradar-amazon-eu5-api-20",
    definition: {
      ...common,
      name: "prixradar-amazon-eu5-api-20",
      title: "PrixRadar · Amazon France · API 20",
      description: "Radar Amazon France high-tech, informatique et maison toutes les 30 minutes, hors pause de 1 h à 7 h.",
      cronExpression: "15,45 0,7-23 * * *",
      actions: [actorAction(actorId, {
        source: "amazon",
        markets: ["FR"],
        mode: "full",
        notify: true,
        browserFallback: false,
        shadowCart: false,
        limit: 20,
        page: 0,
        pageRotation: 12,
        minimumDropPercent: 30,
        // Keep the automatic radar broad inside its configured high-tech,
        // informatique and maison segments. A UI/task can still opt into a
        // narrow brand list when a user explicitly asks for one.
        amazonBrands: ["*"],
        strictAmazonCategories: true,
        verifyAmazonPage: false,
        liveVerificationLimit: 0,
        processEanScans: true,
        useRemoteCoverage: false,
        useRemoteDiscovery: true,
      }, 1_024)],
    },
  }];

  schedules.push({
      name: "prixradar-retail-fr-30min",
      definition: {
        ...common,
        name: "prixradar-retail-fr-30min",
        title: "PrixRadar · Enseignes françaises · 30 min",
        description: "Découvre puis revérifie les produits depuis les pages de départ autorisées.",
        cronExpression: "7,37 * * * *",
        actions: [actorAction(actorId, {
          source: "all",
          urls: retailUrls.map((url) => ({ url })),
          useRemoteCoverage: retailUrls.length === 0,
          mode: "full",
          notify: true,
          browserFallback: true,
          shadowCart: true,
          limit: 30,
          scanAmazon: false,
        }, 1_024)],
      },
    });
  const socialSchedule = (name: string, title: string, cronExpression: string): AutomationSchedule => ({
    name,
    definition: {
      ...common,
      name,
      title,
      description: "Retente uniquement la livraison des notifications Facebook reçues par Gmail ; aucune page Facebook n’est ouverte.",
      cronExpression,
      actions: [actorAction(actorId, {
        mode: "social-dispatch",
        notify: true,
        browserFallback: false,
      }, 1_024)],
    },
  });
  schedules.push(
    socialSchedule("prixradar-facebook-7h30-7h45", "PrixRadar Facebook · 7h30–7h45", "30,45 7 * * *"),
    socialSchedule("prixradar-facebook-8h-14h45", "PrixRadar Facebook · 8h–14h45", "*/15 8-14 * * *"),
    socialSchedule("prixradar-facebook-15h", "PrixRadar Facebook · 15h", "0 15 * * *"),
  );
  schedules.push({
    name: "prixradar-connectors-daily",
    definition: {
      ...common,
      notifications: { email: true },
      name: "prixradar-connectors-daily",
      title: "PrixRadar · Test quotidien des connecteurs",
      description: "Teste les pages de référence sans ingestion ni notification utilisateur.",
      cronExpression: "17 6 * * *",
      actions: [actorAction(actorId, {
        source: "all",
        urls: retailUrls.map((url) => ({ url })),
        useRemoteCoverage: retailUrls.length === 0,
        mode: "fixture",
        notify: false,
        browserFallback: true,
        limit: 5,
        scanAmazon: false,
      }, 1_024)],
    },
  });
  schedules.push({
    name: "prixradar-digest-daily",
    definition: {
      ...common,
      name: "prixradar-digest-daily",
      title: "PrixRadar · Résumés quotidiens",
      description: "Envoie à 18 h le résumé personnel des meilleures anomalies encore actives.",
      cronExpression: "7 18 * * *",
      actions: [actorAction(actorId, { mode: "digest" }, 512)],
    },
  });
  return schedules;
}
