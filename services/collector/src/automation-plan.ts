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
    name: "prixradar-amazon-eu5-hourly",
    definition: {
      ...common,
      name: "prixradar-amazon-eu5-hourly",
      title: "PrixRadar · Amazon EU5 · chaque heure",
      description: "Pilote Keepa Pro limité à 35 jetons maximum par passage, sans notification avant validation du signal.",
      cronExpression: "11 * * * *",
      actions: [actorAction(actorId, {
        source: "amazon",
        markets: ["FR", "DE", "IT", "ES", "GB"],
        mode: "full",
        notify: false,
        browserFallback: false,
        shadowCart: false,
        limit: 2,
        page: 0,
        minimumDropPercent: 40,
        verifyAmazonPage: false,
        liveVerificationLimit: 0,
        useRemoteCoverage: false,
        useRemoteDiscovery: false,
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
