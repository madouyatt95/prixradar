import { PlaywrightCrawler, ProxyConfiguration } from "crawlee";
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

async function visibleArticles(page: Page): Promise<RawFacebookArticle[]> {
  await page.locator('[role="article"]').first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => undefined);
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
    maxConcurrency: 1,
    maxRequestsPerCrawl: FACEBOOK_SOCIAL_SOURCES.length,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: Math.max(20, Math.ceil(options.timeoutMs / 1_000)),
    navigationTimeoutSecs: Math.max(15, Math.ceil(options.timeoutMs / 1_000)),
    useSessionPool: true,
    persistCookiesPerSession: true,
    respectRobotsTxtFile: true,
    ...(proxies ? { proxyConfiguration: proxies } : {}),
    preNavigationHooks: [async ({ page }, gotoOptions) => {
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
      const raw = await visibleArticles(page);
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
