const FACEBOOK_RELAY_START_MINUTES = 7 * 60 + 30;
const FACEBOOK_RELAY_END_MINUTES = 15 * 60;
// Gmail can batch Facebook notifications. A six-hour window avoids losing a
// legitimate post while the UID receipt still guarantees one-time delivery.
const FACEBOOK_EMAIL_MAX_AGE_MS = 6 * 60 * 60_000;

export const ACTIVE_FACEBOOK_GROUPS = Object.freeze({
  "848306336465354": "SARAH - Les Addicts Des Bons Plans",
  "584379244259839": "Bons plans courses et reductions - Melina",
});

export type FacebookEmailPublication = {
  sourceId: `facebook:${string}`;
  externalId: string;
  author: string;
  text: string;
  publicationUrl: string;
  imageUrl: null;
  externalUrl: string | null;
  publishedAt: string;
};

type FacebookEmailContent = {
  from: string;
  subject: string;
  text: string;
  html: string;
  date: Date;
};

const PARIS_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parisMinutes(date: Date) {
  const parts = PARIS_CLOCK.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : -1;
}

/** Facebook emails are polled only from 07:30 through 15:00, Paris time. */
export function isFacebookRelayWindow(date: Date) {
  const minutes = parisMinutes(date);
  return minutes >= FACEBOOK_RELAY_START_MINUTES && minutes <= FACEBOOK_RELAY_END_MINUTES;
}

export function trustedFacebookSender(from: string) {
  const match = /<?([^<>\s]+@[^<>\s]+)>?/u.exec(from);
  const address = (match?.[1] ?? from).trim().toLowerCase();
  return /@(?:[a-z0-9-]+\.)*facebookmail\.com$/iu.test(address);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#(\d{1,7});/gu, (_match, code: string) => {
      const value = Number(code);
      return Number.isSafeInteger(value) && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    })
    .replace(/&#x([0-9a-f]{1,6});/giu, (_match, code: string) => {
      const value = Number.parseInt(code, 16);
      return Number.isSafeInteger(value) && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    });
}

function repeatedlyDecode(value: string) {
  let current = decodeHtmlEntities(value);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const decoded = decodeHtmlEntities(decodeURIComponent(current.replace(/\+/gu, "%20")));
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function normalizeText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function fallbackExternalId(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return `mail-${hash.toString(16).padStart(8, "0")}`;
}

function activeGroupFromContent(decodedContent: string) {
  const normalized = decodedContent.toLowerCase();
  return Object.entries(ACTIVE_FACEBOOK_GROUPS).find(([groupId, name]) => (
    normalized.includes(groupId) || normalized.includes(name.toLowerCase())
  ))?.[0] ?? null;
}

function facebookPublication(decodedContent: string, fallbackSeed: string) {
  const normalized = decodeHtmlEntities(decodedContent).replace(/\\\//gu, "/");
  const absolute = /https?:\/\/(?:www\.|m\.)?facebook\.com\/groups\/(\d{6,20})\/(?:posts|permalink)\/([A-Za-z0-9._:-]{3,160})/iu.exec(normalized);
  const relative = /(?:^|[\s"'=])(\/groups\/(\d{6,20})\/(?:posts|permalink)\/([A-Za-z0-9._:-]{3,160}))/iu.exec(normalized);
  const queryPost = /(?:story_fbid|fbid|multi_permalinks)=([A-Za-z0-9._:-]{3,160})/iu.exec(normalized)?.[1] ?? null;
  const groupId = absolute?.[1] ?? relative?.[2] ?? activeGroupFromContent(normalized);
  const rawPostId = absolute?.[2] ?? relative?.[3] ?? queryPost;
  if (!groupId || !(groupId in ACTIVE_FACEBOOK_GROUPS)) return null;
  if (!rawPostId && !/(?:a publie|a publié|publication|nouveau post|nouvelle publication|posted|shared a post)/iu.test(normalized)) return null;
  const postId = rawPostId?.replace(/[?&#/].*$/gu, "") || fallbackExternalId(fallbackSeed);
  return {
    groupId,
    postId,
    url: rawPostId
      ? `https://www.facebook.com/groups/${groupId}/posts/${postId}/`
      : `https://www.facebook.com/groups/${groupId}/`,
  };
}

function authorFromSubject(subject: string) {
  const cleaned = normalizeText(subject)
    .replace(/^Facebook\s*[-:|]\s*/iu, "")
    .replace(/\s+(?:a publie|a publié|a ajoute une publication|posted|shared a post)(?:\s|$).*$/iu, "")
    .trim();
  if (cleaned && cleaned.length <= 160 && !/^nouvelle publication$/iu.test(cleaned)) return cleaned;
  return "Publication Facebook";
}

function postText(subject: string, plainBody: string) {
  const subjectText = normalizeText(subject);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const rawLine of plainBody.split(/\r?\n/gu)) {
    const line = normalizeText(rawLine);
    if (!line || line === subjectText || /^https?:\/\//iu.test(line)) continue;
    if (/facebookmail|se desabonner|se désabonner|unsubscribe|parametres de notification|paramètres de notification|voir sur facebook|view on facebook|meta platforms/iu.test(line)) continue;
    if (/^(?:j'aime|commenter|partager|like|comment|share)$/iu.test(line)) continue;
    const normalized = line.replace(/https?:\/\/\S+/giu, "").trim();
    if (normalized.length < 3 || seen.has(normalized)) continue;
    seen.add(normalized);
    kept.push(normalized);
  }
  return kept.join(" ").slice(0, 4_000) || subjectText || "Nouvelle publication Facebook";
}

function externalUrl(decodedContent: string) {
  const content = decodeHtmlEntities(decodedContent).replace(/\\\//gu, "/");
  const matches = content.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  for (const match of matches) {
    const candidate = match.replace(/[),.;]+$/gu, "");
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, "");
      if (hostname === "l.facebook.com") {
        const target = parsed.searchParams.get("u");
        if (target) {
          const unwrapped = new URL(target);
          if (unwrapped.protocol === "https:") return unwrapped.toString();
        }
      }
      if (parsed.protocol === "https:" && hostname !== "facebook.com" && hostname !== "m.facebook.com"
        && hostname !== "facebookmail.com" && hostname !== "fbcdn.net" && hostname !== "staticxx.facebook.com"
        && !hostname.endsWith(".facebook.com") && !hostname.endsWith(".fbcdn.net")) {
        return parsed.toString();
      }
    } catch {
      // Truncated tracking URLs are ignored without rejecting the Facebook post.
    }
  }
  return null;
}

export function mentionsActiveFacebookGroup(content: string) {
  const decoded = repeatedlyDecode(content).toLowerCase();
  return Object.entries(ACTIVE_FACEBOOK_GROUPS).some(([groupId, name]) => (
    decoded.includes(groupId) || decoded.includes(name.toLowerCase())
  ));
}

export function parseFacebookEmailContent(
  input: FacebookEmailContent,
  now = new Date(),
): FacebookEmailPublication | null {
  if (!trustedFacebookSender(input.from)) return null;
  const messageTime = input.date.getTime();
  const age = now.getTime() - messageTime;
  if (!Number.isFinite(messageTime) || age < -60_000 || age > FACEBOOK_EMAIL_MAX_AGE_MS) return null;

  const combined = repeatedlyDecode(`${input.subject}\n${input.text}\n${input.html}`);
  const publication = facebookPublication(combined, `${input.subject}|${input.date.toISOString()}|${input.text.slice(0, 500)}`);
  if (!publication) return null;
  return {
    sourceId: `facebook:${publication.groupId}`,
    externalId: publication.postId,
    author: authorFromSubject(input.subject),
    text: postText(input.subject, input.text),
    publicationUrl: publication.url,
    imageUrl: null,
    externalUrl: externalUrl(combined),
    publishedAt: input.date.toISOString(),
  };
}
