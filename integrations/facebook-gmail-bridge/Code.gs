/**
 * PrixRadar - relais des notifications officielles Facebook reçues dans Gmail.
 *
 * Secrets à définir dans Paramètres du projet > Propriétés du script :
 * - PRIXRADAR_BASE_URL
 * - PRIXRADAR_INGEST_SECRET
 */

const PRIXRADAR_TIMEZONE = "Europe/Paris";
const PRIXRADAR_PROCESSED_LABEL = "PrixRadar/Facebook traite";
const PRIXRADAR_REVIEW_LABEL = "PrixRadar/Facebook a verifier";
const PRIXRADAR_MAX_MESSAGE_AGE_MINUTES = 45;
const PRIXRADAR_ACTIVE_GROUPS = Object.freeze({
  "848306336465354": "SARAH - Les Addicts Des Bons Plans",
  "584379244259839": "Bons plans courses et reductions - Melina",
});

function setupPrixRadarFacebookBridge() {
  readConfiguration_();
  getOrCreateLabel_(PRIXRADAR_PROCESSED_LABEL);
  getOrCreateLabel_(PRIXRADAR_REVIEW_LABEL);

  ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === "relayFacebookEmails"; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });

  ScriptApp.newTrigger("relayFacebookEmails")
    .timeBased()
    .everyMinutes(5)
    .create();

  return {
    ok: true,
    cadenceMinutes: 5,
    activeWindow: "07:30-15:00 Europe/Paris",
    groups: Object.keys(PRIXRADAR_ACTIVE_GROUPS).length,
  };
}

function testPrixRadarFacebookBridge() {
  const config = readConfiguration_();
  const prixRadar = UrlFetchApp.fetch(config.baseUrl + "/api/health", {
    method: "get",
    muteHttpExceptions: true,
    headers: { Accept: "application/json" },
  });
  if (prixRadar.getResponseCode() < 200 || prixRadar.getResponseCode() >= 300) {
    throw new Error("PrixRadar ne repond pas correctement (HTTP " + prixRadar.getResponseCode() + ").");
  }

  return { ok: true, prixRadar: true, triggerInstalled: hasRelayTrigger_() };
}

function relayFacebookEmails() {
  return relayFacebookEmails_(false);
}

function relayFacebookEmailsNow() {
  return relayFacebookEmails_(true);
}

function relayFacebookEmails_(forceWindow) {
  if (!forceWindow && !isRelayWindow_(new Date())) {
    return { ok: true, skipped: "outside_active_window" };
  }

  const config = readConfiguration_();
  const processedLabel = getOrCreateLabel_(PRIXRADAR_PROCESSED_LABEL);
  const reviewLabel = getOrCreateLabel_(PRIXRADAR_REVIEW_LABEL);
  const query = "from:(facebookmail.com) newer_than:2d -label:\"" + PRIXRADAR_PROCESSED_LABEL + "\"";
  const threads = GmailApp.search(query, 0, 50);
  const parsedBySource = {};
  const relevantThreads = [];
  let ignoredThreads = 0;
  let reviewThreads = 0;

  threads.forEach(function (thread) {
    let relevant = false;
    let needsReview = false;

    thread.getMessages().forEach(function (message) {
      if (!isFacebookSender_(message.getFrom())) return;
      const age = Date.now() - message.getDate().getTime();
      if (age < -60 * 1000 || age > PRIXRADAR_MAX_MESSAGE_AGE_MINUTES * 60 * 1000) return;

      const subject = message.getSubject() || "";
      const plainBody = message.getPlainBody() || "";
      const htmlBody = message.getBody() || "";
      const parsed = parseFacebookEmailContent_(subject, plainBody, htmlBody, message.getDate());
      if (parsed) {
        relevant = true;
        if (!parsedBySource[parsed.sourceId]) parsedBySource[parsed.sourceId] = {};
        parsedBySource[parsed.sourceId][parsed.externalId] = parsed;
      } else if (mentionsActiveGroup_(subject + "\n" + plainBody + "\n" + htmlBody)) {
        needsReview = true;
      }
    });

    if (relevant) {
      relevantThreads.push(thread);
      return;
    }
    if (needsReview) {
      thread.addLabel(reviewLabel);
      reviewThreads += 1;
    } else {
      ignoredThreads += 1;
    }
    thread.addLabel(processedLabel);
  });

  let accepted = 0;
  let newItems = 0;
  const sourceIds = Object.keys(parsedBySource);
  sourceIds.forEach(function (sourceId) {
    const items = Object.keys(parsedBySource[sourceId]).map(function (externalId) {
      return parsedBySource[sourceId][externalId];
    }).slice(0, 40);
    const result = ingestPublications_(config, sourceId, items);
    accepted += Number(result.accepted || 0);
    newItems += Array.isArray(result.newItems) ? result.newItems.length : 0;
  });

  relevantThreads.forEach(function (thread) { thread.addLabel(processedLabel); });

  return {
    ok: true,
    scannedThreads: threads.length,
    relevantThreads: relevantThreads.length,
    ignoredThreads: ignoredThreads,
    reviewThreads: reviewThreads,
    accepted: accepted,
    newItems: newItems,
    notificationDispatchRequested: accepted > 0,
  };
}

function parseFacebookEmailContent_(subject, plainBody, htmlBody, messageDate) {
  const combined = repeatedlyDecode_(String(subject || "") + "\n" + String(plainBody || "") + "\n" + String(htmlBody || ""));
  const publication = extractFacebookPublication_(combined);
  if (!publication || !PRIXRADAR_ACTIVE_GROUPS[publication.groupId]) return null;

  const publishedAt = messageDate instanceof Date ? messageDate : new Date(messageDate);
  if (!Number.isFinite(publishedAt.getTime())) return null;
  const author = extractAuthor_(String(subject || ""));
  const text = extractPostText_(String(subject || ""), String(plainBody || ""));

  return {
    externalId: publication.postId || sha256Hex_(publication.url).slice(0, 32),
    author: author,
    text: text,
    publicationUrl: publication.url,
    imageUrl: null,
    externalUrl: extractExternalUrl_(combined),
    publishedAt: publishedAt.toISOString(),
    sourceId: "facebook:" + publication.groupId,
  };
}

function extractFacebookPublication_(decodedContent) {
  const normalized = decodeHtmlEntities_(decodedContent).replace(/\\\//g, "/");
  const absolute = /https?:\/\/(?:www\.|m\.)?facebook\.com\/groups\/(\d{6,20})\/(?:posts|permalink)\/([A-Za-z0-9._:-]{3,160})/i.exec(normalized);
  const relative = /(?:^|[\s"'=])(\/groups\/(\d{6,20})\/(?:posts|permalink)\/([A-Za-z0-9._:-]{3,160}))/i.exec(normalized);
  const groupId = absolute ? absolute[1] : relative ? relative[2] : null;
  const postId = absolute ? absolute[2] : relative ? relative[3] : null;
  if (!groupId || !postId) return null;
  return {
    groupId: groupId,
    postId: postId.replace(/[?&#/].*$/g, ""),
    url: "https://www.facebook.com/groups/" + groupId + "/posts/" + postId.replace(/[?&#/].*$/g, "") + "/",
  };
}

function extractAuthor_(subject) {
  const cleaned = normalizeText_(subject)
    .replace(/^Facebook\s*[-:|]\s*/i, "")
    .replace(/\s+(?:a publie|a publié|a ajoute une publication|posted|shared a post)(?:\s|$).*$/i, "")
    .trim();
  if (cleaned && cleaned.length <= 160 && !/^nouvelle publication$/i.test(cleaned)) return cleaned;
  return "Publication Facebook";
}

function extractPostText_(subject, plainBody) {
  const subjectText = normalizeText_(subject);
  const lines = String(plainBody || "").split(/\r?\n/).map(normalizeText_).filter(Boolean);
  const kept = [];
  const seen = {};
  lines.forEach(function (line) {
    if (line === subjectText || /^https?:\/\//i.test(line)) return;
    if (/facebookmail|se desabonner|se désabonner|unsubscribe|parametres de notification|paramètres de notification|voir sur facebook|view on facebook|meta platforms/i.test(line)) return;
    if (/^(j'aime|commenter|partager|like|comment|share)$/i.test(line)) return;
    const normalized = line.replace(/https?:\/\/\S+/g, "").trim();
    if (normalized.length < 3 || seen[normalized]) return;
    seen[normalized] = true;
    kept.push(normalized);
  });
  const bodyText = kept.join(" ").slice(0, 4000);
  return bodyText || subjectText || "Nouvelle publication Facebook";
}

function extractExternalUrl_(decodedContent) {
  const content = decodeHtmlEntities_(decodedContent).replace(/\\\//g, "/");
  const matches = content.match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (let index = 0; index < matches.length; index += 1) {
    const candidate = matches[index].replace(/[),.;]+$/g, "");
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (!/^(?:facebook\.com|m\.facebook\.com|facebookmail\.com|fbcdn\.net|staticxx\.facebook\.com)$/i.test(hostname)
        && !hostname.endsWith(".facebook.com") && !hostname.endsWith(".fbcdn.net")) {
        return parsed.toString();
      }
    } catch (error) {
      // Une URL de suivi tronquée n'empêche pas l'ingestion du post Facebook.
    }
  }
  return null;
}

function mentionsActiveGroup_(content) {
  const decoded = repeatedlyDecode_(String(content || ""));
  return Object.keys(PRIXRADAR_ACTIVE_GROUPS).some(function (groupId) {
    return decoded.indexOf(groupId) >= 0 || decoded.toLowerCase().indexOf(PRIXRADAR_ACTIVE_GROUPS[groupId].toLowerCase()) >= 0;
  });
}

function ingestPublications_(config, sourceId, items) {
  const response = UrlFetchApp.fetch(config.baseUrl + "/api/social/ingest", {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + config.ingestSecret, Accept: "application/json" },
    payload: JSON.stringify({
      sourceId: sourceId,
      scannedAt: new Date().toISOString(),
      successful: true,
      items: items.map(function (item) {
        return {
          externalId: item.externalId,
          author: item.author,
          text: item.text,
          publicationUrl: item.publicationUrl,
          imageUrl: item.imageUrl,
          externalUrl: item.externalUrl,
          publishedAt: item.publishedAt,
        };
      }),
    }),
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error("Ingestion PrixRadar refusee (HTTP " + code + ").");
  const body = JSON.parse(response.getContentText());
  if (body.ok !== true) throw new Error("Reponse d'ingestion PrixRadar invalide.");
  return body;
}

function readConfiguration_() {
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = String(properties.getProperty("PRIXRADAR_BASE_URL") || "").trim().replace(/\/+$/, "");
  const ingestSecret = String(properties.getProperty("PRIXRADAR_INGEST_SECRET") || "").trim();
  if (!/^https:\/\/[^/]+$/i.test(baseUrl)) throw new Error("PRIXRADAR_BASE_URL est absent ou invalide.");
  if (ingestSecret.length < 24) throw new Error("PRIXRADAR_INGEST_SECRET est absent ou invalide.");
  return { baseUrl: baseUrl, ingestSecret: ingestSecret };
}

function isRelayWindow_(now) {
  const hhmm = Number(Utilities.formatDate(now, PRIXRADAR_TIMEZONE, "HHmm"));
  return hhmm >= 730 && hhmm <= 1500;
}

function isFacebookSender_(from) {
  const match = /<?([^<>\s]+@[^<>\s]+)>?/.exec(String(from || ""));
  const address = match ? match[1].toLowerCase() : String(from || "").toLowerCase();
  return /@(?:[a-z0-9-]+\.)*facebookmail\.com$/i.test(address);
}

function repeatedlyDecode_(value) {
  let current = decodeHtmlEntities_(String(value || ""));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current.replace(/\+/g, "%20"));
      if (decoded === current) break;
      current = decoded;
    } catch (error) {
      break;
    }
  }
  return current;
}

function decodeHtmlEntities_(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeText_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sha256Hex_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(function (byte) { return (byte + 256).toString(16).slice(-2); }).join("");
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function hasRelayTrigger_() {
  return ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === "relayFacebookEmails";
  });
}
