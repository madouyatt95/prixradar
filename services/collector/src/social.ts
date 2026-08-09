import { PlaywrightCrawler, ProxyConfiguration } from "crawlee";
import { Actor } from "apify";
import { chromium, type Page } from "playwright";

export type FacebookSocialSource = {
  id: `facebook:${string}`;
  platform: "facebook";
  name: string;
  groupId: string;
  url: string;
};

export type SocialPublication = {
  externalId: string;
  author: string;
  text: string;
  publicationUrl: string;
  imageUrl: string | null;
  externalUrl: string | null;
  publishedAt: string;
};

export type SocialSourceResult = {
  source: FacebookSocialSource;
  publications: SocialPublication[];
  loadedUrl: string | null;
  errorCode: string | null;
};

export const FACEBOOK_SOCIAL_SOURCES: readonly FacebookSocialSource[] = [
  {
    id: "facebook:848306336465354",
    platform: "facebook",
    name: "SARAH · Les Addicts Des Bons Plans",
    groupId: "848306336465354",
    url: "https://www.facebook.com/groups/848306336465354/",
  },
  {
    id: "facebook:1262689252631531",
    platform: "facebook",
    name: "SARAH · Bons Plans Sarah good deals",
    groupId: "1262689252631531",
    url: "https://www.facebook.com/groups/1262689252631531/",
  },
  {
    id: "facebook:422132183776421",
    platform: "facebook",
    name: "Bons plans et erreurs de prix · Lacerise",
    groupId: "422132183776421",
    url: "https://www.facebook.com/groups/422132183776421/",
  },
  {
    id: "facebook:584379244259839",
    platform: "facebook",
    name: "Bons plans courses et réductions · Mélina",
    groupId: "584379244259839",
    url: "https://www.facebook.com/groups/584379244259839/",
  },
];

export const FACEBOOK_GROUPS_ACTOR_ID = "apify/facebook-groups-scraper";

type OfficialFacebookPost = Record<string, unknown>;

type ActorRunCost = {
  usageTotalUsd?: number;
  chargedEventCounts?: Record<string, number>;
  pricingInfo?: {
    pricingModel?: string;
    pricePerUnitUsd?: number;
    pricingPerEvent?: {
      actorChargeEvents?: Record<string, {
        eventPriceUsd?: number;
      }>;
    };
  };
};

export type OfficialFacebookRunResult = {
  providerRunId: string;
  usageTotalUsd: number | null;
  finishedAt: string;
  rawItemsCount: number;
  results: SocialSourceResult[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function actorRunCostUsd(run: ActorRunCost, datasetItemsCount = 0) {
  if (run.pricingInfo?.pricingModel === "PAY_PER_EVENT") {
    const eventPrices = run.pricingInfo.pricingPerEvent?.actorChargeEvents ?? {};
    const total = Object.entries(run.chargedEventCounts ?? {}).reduce((sum, [eventName, count]) => {
      const price = eventPrices[eventName]?.eventPriceUsd;
      return Number.isFinite(count) && count >= 0 && Number.isFinite(price) && (price ?? -1) >= 0
        ? sum + count * (price ?? 0)
        : sum;
    }, 0);
    if (total > 0) return Math.round(total * 1_000_000) / 1_000_000;
  }
  if (run.pricingInfo?.pricingModel === "PRICE_PER_DATASET_ITEM") {
    const price = run.pricingInfo.pricePerUnitUsd;
    if (Number.isFinite(price) && (price ?? -1) >= 0 && Number.isSafeInteger(datasetItemsCount) && datasetItemsCount >= 0) {
      return Math.round(datasetItemsCount * (price ?? 0) * 1_000_000) / 1_000_000;
    }
  }
  return typeof run.usageTotalUsd === "number" && Number.isFinite(run.usageTotalUsd) && run.usageTotalUsd >= 0
    ? run.usageTotalUsd
    : null;
}

export function officialFacebookRunCostUsd(run: ActorRunCost, datasetItemsCount: number) {
  const reported = actorRunCostUsd(run, datasetItemsCount) ?? 0;
  // The official Actor can omit its pay-per-event details from a child-run response.
  // Keep the Free-plan ceiling as a safe floor: $0.001/run + $0.007/date-filtered item.
  const conservative = 0.001 + Math.max(0, datasetItemsCount) * 0.007;
  return Math.max(reported, conservative);
}

function cleanString(value: unknown, maximum = 2_048) {
  return typeof value === "string" ? value.replace(/\r\n?/gu, "\n").trim().slice(0, maximum) : "";
}

function groupIdFromUrl(value: unknown) {
  const raw = cleanString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return /^\/groups\/(\d{6,20})(?:\/|$)/u.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value: unknown) {
  const raw = cleanString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString().slice(0, 2_048);
  } catch {
    return null;
  }
}

function externalOfficialUrl(value: unknown) {
  const url = safeHttpsUrl(value);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch" ? null : url;
}

function nestedUrl(value: unknown, keys: readonly string[]): string | null {
  const item = record(value);
  if (!item) return null;
  for (const key of keys) {
    const direct = safeHttpsUrl(item[key]);
    if (direct) return direct;
    const nested = record(item[key]);
    if (nested) {
      const candidate = nestedUrl(nested, ["url", "uri", "href", "targetUrl"]);
      if (candidate) return candidate;
    }
  }
  return null;
}

function officialImage(value: unknown) {
  const attachments = Array.isArray(value) ? value : [];
  for (const attachment of attachments) {
    const candidate = nestedUrl(attachment, ["image", "photo", "thumbnail", "media", "url", "uri"]);
    if (!candidate) continue;
    const host = new URL(candidate).hostname.toLowerCase();
    if (host.includes("fbcdn") || host.startsWith("scontent")) return candidate;
  }
  return null;
}

function firstExternalTextUrl(text: string) {
  const matches = text.match(/https:\/\/[^\s<>()]+/gu) ?? [];
  for (const match of matches) {
    const url = externalOfficialUrl(match.replace(/[.,;!?]+$/u, ""));
    if (url) return url;
  }
  return null;
}

export function normalizeOfficialFacebookPost(
  value: unknown,
  sources: readonly FacebookSocialSource[],
): { sourceId: FacebookSocialSource["id"]; publication: SocialPublication } | null {
  const item = record(value);
  if (!item) return null;
  const groupId = groupIdFromUrl(item.facebookUrl)
    ?? groupIdFromUrl(item.inputUrl)
    ?? groupIdFromUrl(item.url);
  const source = sources.find((candidate) => candidate.groupId === groupId);
  if (!source) return null;

  const rawPublicationUrl = safeHttpsUrl(item.url);
  if (!rawPublicationUrl) return null;
  const publicationHost = new URL(rawPublicationUrl).hostname.toLowerCase().replace(/^www\./u, "");
  if (publicationHost !== "facebook.com" && publicationHost !== "m.facebook.com") return null;
  const urlId = /\/(?:posts|permalink)\/(\d{5,30})(?:\/|$)/u.exec(new URL(rawPublicationUrl).pathname)?.[1];
  const rawId = cleanString(item.legacyId, 160) || cleanString(item.id, 160) || urlId || "";
  const externalId = /^[A-Za-z0-9._:-]{3,160}$/u.test(rawId) ? rawId : urlId;
  if (!externalId) return null;

  const title = cleanString(item.title, 1_000);
  const postText = cleanString(item.text, 4_000);
  const text = [title, postText].filter((part, index, all) => part && all.indexOf(part) === index).join("\n").slice(0, 4_000);
  if (!text) return null;
  const publishedAtMs = Date.parse(cleanString(item.time, 64));
  if (!Number.isFinite(publishedAtMs)) return null;
  const user = record(item.user);
  const author = cleanString(user?.name ?? user?.profileName, 160) || source.name;
  const actionLink = nestedUrl(item.actionLink, ["url", "href", "targetUrl"]);
  const previewTarget = nestedUrl(item.previewTarget, ["url", "href", "targetUrl"]);
  const externalUrl = externalOfficialUrl(item.link)
    ?? externalOfficialUrl(actionLink)
    ?? externalOfficialUrl(previewTarget)
    ?? firstExternalTextUrl(text);

  return {
    sourceId: source.id,
    publication: {
      externalId,
      author,
      text,
      publicationUrl: rawPublicationUrl,
      imageUrl: officialImage(item.attachments),
      externalUrl,
      publishedAt: new Date(publishedAtMs).toISOString(),
    },
  };
}

export async function collectOfficialFacebookSources(options: {
  sources: readonly FacebookSocialSource[];
  cursorAt: string;
  resultLimitPerSource: number;
  timeoutSecs?: number;
}): Promise<OfficialFacebookRunResult> {
  if (options.sources.length === 0) throw new Error("Aucun groupe Facebook actif.");
  const run = await Actor.call(FACEBOOK_GROUPS_ACTOR_ID, {
    startUrls: options.sources.map((source) => ({ url: source.url })),
    resultsLimit: Math.max(1, Math.min(100, options.resultLimitPerSource)),
    viewOption: "CHRONOLOGICAL",
    onlyPostsNewerThan: options.cursorAt,
  }, {
    memory: 1_024,
    timeout: options.timeoutSecs ?? 180,
    waitSecs: (options.timeoutSecs ?? 180) + 30,
  });
  if (run.status !== "SUCCEEDED") {
    throw new Error(`L’Actor Facebook s’est terminé avec le statut ${run.status}.`);
  }
  const dataset = await Actor.openDataset<OfficialFacebookPost>(run.defaultDatasetId);
  const data = await dataset.getData({
    limit: Math.min(1_000, options.sources.length * Math.max(1, options.resultLimitPerSource) + 20),
    clean: true,
  });
  const grouped = new Map<string, Map<string, SocialPublication>>(
    options.sources.map((source) => [source.id, new Map()]),
  );
  for (const raw of data.items) {
    const normalized = normalizeOfficialFacebookPost(raw, options.sources);
    if (normalized) grouped.get(normalized.sourceId)?.set(normalized.publication.externalId, normalized.publication);
  }
  return {
    providerRunId: run.id,
    usageTotalUsd: officialFacebookRunCostUsd(run, data.items.length),
    finishedAt: run.finishedAt instanceof Date ? run.finishedAt.toISOString() : new Date().toISOString(),
    rawItemsCount: data.items.length,
    results: options.sources.map((source) => ({
      source,
      publications: [...(grouped.get(source.id)?.values() ?? [])],
      loadedUrl: source.url,
      errorCode: null,
    })),
  };
}

type RawFacebookArticle = {
  text: string;
  hrefs: string[];
  imageUrl: string | null;
  dateTime: string | null;
  timeLabels: string[];
};

const UI_LINE = /^(?:j['’]aime|commenter|partager|voir plus|voir \d+ réponses?|toutes les réactions|écrire un commentaire|répondre|masquer|plus)$/iu;
const META_LINE = /^(?:admin|modérateur|contenu ia|·|suivre|groupe géré par .+)$/iu;
const RELATIVE_TIME = /^(?:(\d+)\s*(min|h|j|sem)|hier)(?:\s*·.*)?$/iu;

function compactLines(value: string) {
  return value.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

function relativePublishedAt(labels: readonly string[], now: Date) {
  for (const label of labels) {
    const normalized = label.trim().toLocaleLowerCase("fr");
    const milliseconds = Date.parse(label);
    if (Number.isFinite(milliseconds) && /\d{4}/u.test(label)) return new Date(milliseconds).toISOString();
    const epoch = /^\d{10}$/u.test(normalized) ? Number(normalized) * 1_000 : NaN;
    if (Number.isFinite(epoch)) return new Date(epoch).toISOString();
    const match = RELATIVE_TIME.exec(normalized);
    if (!match) continue;
    if (normalized.startsWith("hier")) return new Date(now.getTime() - 86_400_000).toISOString();
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    const multiplier = unit === "min" ? 60_000 : unit === "h" ? 3_600_000 : unit === "j" ? 86_400_000 : 7 * 86_400_000;
    return new Date(now.getTime() - amount * multiplier).toISOString();
  }
  return now.toISOString();
}

function facebookPost(hrefs: readonly string[], source: FacebookSocialSource) {
  for (const href of hrefs) {
    try {
      const url = new URL(href, source.url);
      const host = url.hostname.toLowerCase().replace(/^www\./u, "");
      if (host !== "facebook.com" && host !== "m.facebook.com") continue;
      const direct = new RegExp(`^/groups/${source.groupId}/posts/(\\d{5,30})`, "u").exec(url.pathname);
      const permalinkId = url.pathname.endsWith("/permalink.php") && url.searchParams.get("story_fbid");
      const externalId = direct?.[1] ?? (permalinkId && /^\d{5,30}$/u.test(permalinkId) ? permalinkId : null);
      if (!externalId) continue;
      return {
        externalId,
        publicationUrl: `https://www.facebook.com/groups/${source.groupId}/posts/${externalId}/`,
      };
    } catch {
      // Ignore les liens de navigation internes mal formés.
    }
  }
  return null;
}

function externalLink(hrefs: readonly string[]) {
  for (const href of hrefs) {
    try {
      let url = new URL(href, "https://www.facebook.com/");
      if (url.hostname.toLowerCase() === "l.facebook.com") {
        const target = url.searchParams.get("u");
        if (!target) continue;
        url = new URL(target);
      }
      const host = url.hostname.toLowerCase().replace(/^www\./u, "");
      if (url.protocol !== "https:" || url.username || url.password) continue;
      if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") continue;
      return url.toString().slice(0, 2_048);
    } catch {
      // Ignore les URL externes incomplètes.
    }
  }
  return null;
}

export function parseFacebookArticle(raw: RawFacebookArticle, source: FacebookSocialSource, now = new Date()): SocialPublication | null {
  const post = facebookPost(raw.hrefs, source);
  if (!post) return null;
  const lines = compactLines(raw.text);
  const author = lines.find((line) => !META_LINE.test(line) && !RELATIVE_TIME.test(line) && !/^\d+$/u.test(line) && !UI_LINE.test(line))?.slice(0, 160) || source.name;
  const authorIndex = Math.max(0, lines.indexOf(author));
  const content: string[] = [];
  for (const line of lines.slice(authorIndex + 1)) {
    if (UI_LINE.test(line)) break;
    if (META_LINE.test(line) || RELATIVE_TIME.test(line) || /^\d{1,6}$/u.test(line)) continue;
    if (line === author) continue;
    content.push(line);
  }
  const text = (content.join("\n") || lines.join("\n")).slice(0, 4_000).trim();
  if (!text) return null;
  return {
    ...post,
    author,
    text,
    imageUrl: raw.imageUrl?.startsWith("https://") ? raw.imageUrl.slice(0, 2_048) : null,
    externalUrl: externalLink(raw.hrefs),
    publishedAt: relativePublishedAt([raw.dateTime ?? "", ...raw.timeLabels, ...lines.slice(0, 8)], now),
  };
}

async function dismissPublicCookieDialog(page: Page) {
  const decline = page.getByRole("button", {
    name: /(?:refuser les cookies optionnels|decline optional cookies|only allow essential cookies)/iu,
  }).first();
  if (await decline.isVisible({ timeout: 2_500 }).catch(() => false)) {
    await decline.click({ timeout: 2_500 }).catch(() => undefined);
    await page.waitForTimeout(350);
  }
}

async function visibleArticles(page: Page, groupId: string): Promise<RawFacebookArticle[]> {
  await dismissPublicCookieDialog(page);
  const postLink = page.locator(`a[href*="/groups/${groupId}/posts/"]`).first();
  await postLink.waitFor({ state: "attached", timeout: 10_000 }).catch(() => undefined);
  for (let pass = 0; pass < 2; pass += 1) {
    await page.mouse.wheel(0, 1_200);
    await page.waitForTimeout(650);
  }
  return page.locator('[role="article"]').evaluateAll((articles) => articles.slice(0, 24).map((article) => {
    const anchors = [...article.querySelectorAll<HTMLAnchorElement>("a[href]")];
    const image = [...article.querySelectorAll<HTMLImageElement>("img[src]")]
      .find((candidate) => candidate.naturalWidth >= 180 || candidate.clientWidth >= 180);
    const time = article.querySelector<HTMLElement>("time[datetime], abbr[data-utime]");
    return {
      text: (article as HTMLElement).innerText ?? article.textContent ?? "",
      hrefs: anchors.map((anchor) => anchor.href).filter(Boolean),
      imageUrl: image?.currentSrc || image?.src || null,
      dateTime: time?.getAttribute("datetime") ?? time?.getAttribute("data-utime") ?? null,
      timeLabels: anchors.flatMap((anchor) => [anchor.getAttribute("aria-label"), anchor.getAttribute("title"), anchor.textContent]).filter((value): value is string => Boolean(value)),
    };
  }));
}

function proxyConfiguration(proxyUrls: readonly string[]) {
  const cleaned = proxyUrls.map((url) => url.trim()).filter(Boolean);
  return cleaned.length > 0 ? new ProxyConfiguration({ proxyUrls: cleaned }) : undefined;
}

export async function collectFacebookSocialSources(options: {
  timeoutMs: number;
  proxyUrls: readonly string[];
  now?: Date;
}): Promise<SocialSourceResult[]> {
  const now = options.now ?? new Date();
  const results = new Map<string, SocialSourceResult>();
  const proxies = proxyConfiguration(options.proxyUrls);
  const crawler = new PlaywrightCrawler({
    launchContext: { launcher: chromium, launchOptions: { headless: true } },
    maxConcurrency: 2,
    maxRequestsPerCrawl: FACEBOOK_SOCIAL_SOURCES.length,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: Math.max(20, Math.ceil(options.timeoutMs / 1_000)),
    navigationTimeoutSecs: Math.max(15, Math.ceil(options.timeoutMs / 1_000)),
    useSessionPool: true,
    persistCookiesPerSession: true,
    respectRobotsTxtFile: true,
    ...(proxies ? { proxyConfiguration: proxies } : {}),
    preNavigationHooks: [async ({ page }, gotoOptions) => {
      await page.setViewportSize({ width: 1_280, height: 1_600 });
      await page.setExtraHTTPHeaders({ "accept-language": "fr-FR,fr;q=0.9,en;q=0.5" });
      gotoOptions.waitUntil = "domcontentloaded";
    }],
    onSkippedRequest: async ({ url, reason }) => {
      const source = FACEBOOK_SOCIAL_SOURCES.find((candidate) => url.startsWith(candidate.url));
      if (source) results.set(source.id, { source, publications: [], loadedUrl: null, errorCode: reason === "robotsTxt" ? "ROBOTS_TXT_DISALLOWED" : "REQUEST_SKIPPED" });
    },
    requestHandler: async ({ page, request }) => {
      const source = FACEBOOK_SOCIAL_SOURCES.find((candidate) => candidate.id === request.userData.sourceId);
      if (!source) return;
      const loaded = new URL(page.url());
      const loadedGroup = /^\/groups\/(\d{6,20})/u.exec(loaded.pathname)?.[1];
      if (!loaded.hostname.endsWith("facebook.com") || loadedGroup !== source.groupId) {
        results.set(source.id, { source, publications: [], loadedUrl: page.url(), errorCode: "UNEXPECTED_REDIRECT" });
        return;
      }
      const raw = await visibleArticles(page, source.groupId);
      const unique = new Map<string, SocialPublication>();
      for (const article of raw) {
        const publication = parseFacebookArticle(article, source, now);
        if (publication) unique.set(publication.externalId, publication);
      }
      results.set(source.id, {
        source,
        publications: [...unique.values()],
        loadedUrl: page.url(),
        errorCode: unique.size > 0 ? null : "NO_PUBLICATION_VISIBLE",
      });
    },
    failedRequestHandler: async ({ request, error }) => {
      const source = FACEBOOK_SOCIAL_SOURCES.find((candidate) => candidate.id === request.userData.sourceId);
      if (!source) return;
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      results.set(source.id, {
        source,
        publications: [],
        loadedUrl: request.loadedUrl ?? null,
        errorCode: /(?:403|429|captcha|blocked|access denied)/u.test(message) ? "ANTI_BOT_BLOCKED" : "FACEBOOK_LOAD_FAILED",
      });
    },
  });
  await crawler.run(FACEBOOK_SOCIAL_SOURCES.map((source) => ({
    url: source.url,
    uniqueKey: `${source.id}:${now.toISOString().slice(0, 16)}`,
    userData: { sourceId: source.id },
  })));
  return FACEBOOK_SOCIAL_SOURCES.map((source) => results.get(source.id) ?? ({
    source,
    publications: [],
    loadedUrl: null,
    errorCode: "SOURCE_NOT_VISITED",
  }));
}
