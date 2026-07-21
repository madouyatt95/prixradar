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
    name: "prixradar-amazon-eu5-15min",
    definition: {
      ...common,
      name: "prixradar-amazon-eu5-15min",
      title: "PrixRadar · Amazon EU5 · 15 min",
      description: "Keepa découvre les baisses EU5; les meilleurs candidats sont contrôlés deux fois sur Amazon.",
      cronExpression: "*/15 * * * *",
      actions: [actorAction(actorId, {
        source: "amazon",
        markets: ["FR", "DE", "IT", "ES", "GB"],
        mode: "full",
        notify: true,
        browserFallback: true,
        limit: 15,
        page: 0,
        minimumDropPercent: 30,
        verifyAmazonPage: true,
        liveVerificationLimit: 5,
      }, 1_024)],
    },
  }];

  if (retailUrls.length > 0) {
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
          mode: "full",
          notify: true,
          browserFallback: true,
          limit: 30,
        }, 1_024)],
      },
    });
  }
  return schedules;
}
