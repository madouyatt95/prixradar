import { ApifyClient } from "apify-client";

import { buildAutomationPlan } from "./automation-plan.js";

function retailUrls(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const unique = new Set<string>();
  for (const raw of value.split(/[\n,]/u)) {
    const cleaned = raw.trim();
    if (!cleaned) continue;
    const url = new URL(cleaned);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("PRIXRADAR_RETAIL_URLS doit contenir uniquement des URL HTTPS publiques.");
    }
    unique.add(url.toString());
  }
  return [...unique];
}

export async function provision(apply = false, environment: NodeJS.ProcessEnv = process.env) {
  const actorId = environment.APIFY_ACTOR_ID?.trim() || "<APIFY_ACTOR_ID>";
  const plan = buildAutomationPlan(actorId, retailUrls(environment.PRIXRADAR_RETAIL_URLS));
  if (!apply) return { mode: "dry-run" as const, plan };

  const token = environment.APIFY_TOKEN?.trim();
  if (!token) throw new Error("APIFY_TOKEN est obligatoire avec --apply.");
  if (actorId === "<APIFY_ACTOR_ID>") throw new Error("APIFY_ACTOR_ID est obligatoire avec --apply.");

  const client = new ApifyClient({ token });
  const existing = await client.schedules().list({ limit: 1_000 });
  const byName = new Map(existing.items.map((schedule) => [schedule.name, schedule]));
  const results: Array<{ name: string; action: "created" | "updated"; id: string }> = [];
  for (const schedule of plan) {
    const found = byName.get(schedule.name);
    if (found) {
      const updated = await client.schedule(found.id).update(schedule.definition);
      results.push({ name: schedule.name, action: "updated", id: updated.id });
    } else {
      const created = await client.schedules().create(schedule.definition);
      results.push({ name: schedule.name, action: "created", id: created.id });
    }
  }
  return { mode: "apply" as const, results };
}

const apply = process.argv.includes("--apply");
provision(apply)
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Échec du provisionnement Apify."}\n`);
    process.exitCode = 1;
  });
