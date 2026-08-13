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
const PRIXRADAR_PROCESSED_MESSAGES_PROPERTY = "PRIXRADAR_FACEBOOK_MESSAGE_IDS";
const PRIXRADAR_MAX_MESSAGE_AGE_MINUTES = 6 * 60;
const PRIXRADAR_MAX_TRACKED_MESSAGES = 200;
const PRIXRADAR_SEARCH_PAGE_SIZE = 100;
const PRIXRADAR_INGEST_BATCH_SIZE = 40;
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
    .everyMinutes(1)
    .create();

  return {
    ok: true,
    cadenceMinutes: 1,
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

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    return { ok: true, skipped: "relay_already_running" };
  }

  try {
    return relayFacebookEmailsLocked_();
  } finally {
    lock.releaseLock();
  }
}

function relayFacebookEmailsLocked_() {
  const config = readConfiguration_();
  const processedLabel = getOrCreateLabel_(PRIXRADAR_PROCESSED_LABEL);
  const reviewLabel = getOrCreateLabel_(PRIXRADAR_REVIEW_LABEL);
  // A Gmail label applies to the whole conversation. It must not be excluded
  // from the query: Facebook can append a new notification to an already
  // labelled conversation. Message IDs provide the real idempotency boundary.
  const query = "from:(facebookmail.com) newer_than:1d";
  const processedMessages = readProcessedMessages_();
  const parsedBySource = {};
  let scannedThreads = 0;
  let relevantThreads = 0;
  let ignoredThreads = 0;
  let reviewThreads = 0;
  let searchStart = 0;

  while (true) {
    const threads = GmailApp.search(query, searchStart, PRIXRADAR_SEARCH_PAGE_SIZE);
    if (threads.length === 0) break;
    scannedThreads += threads.length;

    threads.forEach(function (thread) {
      let relevant = false;
      let needsReview = false;

      thread.getMessages().forEach(function (message) {
        const messageId = String(message.getId() || "");
        if (messageId && processedMessages[messageId]) return;
        if (!isFacebookSender_(message.getFrom())) return;
        const age = Date.now() - message.getDate().getTime();
        if (age < -60 * 1000 || age > PRIXRADAR_MAX_MESSAGE_AGE_MINUTES * 60 * 1000) {
          if (messageId) processedMessages[messageId] = Date.now();
          return;
        }

        const subject = message.getSubject() || "";
        const plainBody = message.getPlainBody() || "";
        const htmlBody = message.getBody() || "";
        const parsed = parseFacebookEmailContent_(subject, plainBody, htmlBody, message.getDate());
        if (parsed) {
          relevant = true;
          if (!parsedBySource[parsed.sourceId]) parsedBySource[parsed.sourceId] = {};
          if (!parsedBySource[parsed.sourceId][parsed.externalId]) {
            parsedBySource[parsed.sourceId][parsed.externalId] = {
              publication: parsed,
              messageIds: {},
              threads: [],
            };
          }
          const pending = parsedBySource[parsed.sourceId][parsed.externalId];
          if (messageId) pending.messageIds[messageId] = true;
          if (pending.threads.indexOf(thread) < 0) pending.threads.push(thread);
        } else if (mentionsActiveGroup_(subject + "\n" + plainBody + "\n" + htmlBody)) {
          needsReview = true;
        }
        if (!parsed && messageId) processedMessages[messageId] = Date.now();
      });

      if (needsReview) {
        thread.addLabel(reviewLabel);
        reviewThreads += 1;
      }
      if (relevant) {
        relevantThreads += 1;
        return;
      }
      if (!needsReview) {
        ignoredThreads += 1;
      }
      thread.addLabel(processedLabel);
    });

    // Ignored/review receipts are independent from the network and can be
    // checkpointed after every page. Relevant messages remain pending.
    writeProcessedMessages_(processedMessages);
    searchStart += threads.length;
    if (threads.length < PRIXRADAR_SEARCH_PAGE_SIZE) break;
  }

  let accepted = 0;
  let newItems = 0;
  let notificationDispatchRequested = false;
  let notificationDispatchStarted = false;
  const sourceIds = Object.keys(parsedBySource);
  sourceIds.forEach(function (sourceId) {
    const pending = Object.keys(parsedBySource[sourceId]).map(function (externalId) {
      return parsedBySource[sourceId][externalId];
    });
    for (let offset = 0; offset < pending.length; offset += PRIXRADAR_INGEST_BATCH_SIZE) {
      const batch = pending.slice(offset, offset + PRIXRADAR_INGEST_BATCH_SIZE);
      const items = batch.map(function (entry) { return entry.publication; });
      const result = ingestPublications_(config, sourceId, items);
      const batchAccepted = Number(result.accepted || 0);
      if (batchAccepted !== items.length) {
        throw new Error("Ingestion PrixRadar partielle (" + batchAccepted + "/" + items.length + ").");
      }
      accepted += batchAccepted;
      newItems += Array.isArray(result.newItems) ? result.newItems.length : 0;
      notificationDispatchRequested = notificationDispatchRequested || Boolean(result.notificationDispatch && result.notificationDispatch.requested);
      notificationDispatchStarted = notificationDispatchStarted || Boolean(result.notificationDispatch && result.notificationDispatch.started);

      batch.forEach(function (entry) {
        Object.keys(entry.messageIds).forEach(function (messageId) {
          processedMessages[messageId] = Date.now();
        });
      });
      // Commit each successful batch before moving to another source. A later
      // outage therefore retries only the messages that were not accepted.
      writeProcessedMessages_(processedMessages);
      batch.forEach(function (entry) {
        entry.threads.forEach(function (thread) { thread.addLabel(processedLabel); });
      });
    }
  });

  return {
    ok: true,
    scannedThreads: scannedThreads,
    relevantThreads: relevantThreads,
    ignoredThreads: ignoredThreads,
    reviewThreads: reviewThreads,
    accepted: accepted,
    newItems: newItems,
    notificationDispatchRequested: notificationDispatchRequested,
    notificationDispatchStarted: notificationDispatchStarted,
  };
}

function parseFacebookEmailContent_(subject, plainBody, htmlBody, messageDate) {
  if (!isNewPublicationNotification_(subject)) return null;
  const combined = repeatedlyDecode_(String(subject || "") + "\n" + String(plainBody || "") + "\n" + String(htmlBody || ""));
  const publishedAt = messageDate instanceof Date ? messageDate : new Date(messageDate);
  if (!Number.isFinite(publishedAt.getTime())) return null;
  const publication = extractFacebookPublication_(
    combined,
    String(subject || "") + "|" + publishedAt.toISOString() + "|" + String(plainBody || "").slice(0, 500),
  );
  if (!publication || !PRIXRADAR_ACTIVE_GROUPS[publication.groupId]) return null;

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

function extractFacebookPublication_(decodedContent, fallbackSeed) {
  const normalized = decodeHtmlEntities_(decodedContent).replace(/\\\//g, "/");
  const absolute = /https?:\/\/(?:www\.|m\.)?facebook\.com\/groups\/(\d{6,20})\/(?:posts|permalink)\/([A-Za-z0-9._:-]{3,160})/i.exec(normalized);
  const relative = /(?:^|[\s"'=])(\/groups\/(\d{6,20})\/(?:posts|permalink)\/([A-Za-z0-9._:-]{3,160}))/i.exec(normalized);
  const queryPost = /(?:story_fbid|fbid|multi_permalinks)=([A-Za-z0-9._:-]{3,160})/i.exec(normalized);
  const groupId = absolute ? absolute[1] : relative ? relative[2] : activeGroupFromContent_(normalized);
  const rawPostId = absolute ? absolute[2] : relative ? relative[3] : queryPost ? queryPost[1] : null;
  if (!groupId || !PRIXRADAR_ACTIVE_GROUPS[groupId]) return null;
  const postId = rawPostId ? rawPostId.replace(/[?&#/].*$/g, "") : fallbackExternalId_(fallbackSeed);
  return {
    groupId: groupId,
    postId: postId,
    url: rawPostId
      ? "https://www.facebook.com/groups/" + groupId + "/posts/" + postId + "/"
      : "https://www.facebook.com/groups/" + groupId + "/",
  };
}

function normalizeGroupIdentity_(value) {
  return normalizeText_(String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isNewPublicationNotification_(subject) {
  const normalized = normalizeGroupIdentity_(repeatedlyDecode_(String(subject || "")));
  if (!normalized) return false;
  if (/\b(?:commentaire|commentaires|reaction|reactions|(?:a|ont) (?:commente|repondu|reagi|aime|mentionne)|commented|replied|reacted|liked|mentioned|new comment)\b/i.test(normalized)) {
    return false;
  }
  return /\b(?:(?:a|ont) (?:publie|partage)(?: une publication)?|(?:a|ont) ajoute une (?:nouvelle )?publication|nouvelle publication|nouveau(?:x)? posts?|new posts?|posted in|posted to|shared a post)\b/i.test(normalized);
}

function activeGroupFromContent_(content) {
  const normalized = normalizeGroupIdentity_(content);
  const groupIds = Object.keys(PRIXRADAR_ACTIVE_GROUPS);
  for (let index = 0; index < groupIds.length; index += 1) {
    const groupId = groupIds[index];
    if (normalized.indexOf(groupId) >= 0
      || normalized.indexOf(normalizeGroupIdentity_(PRIXRADAR_ACTIVE_GROUPS[groupId])) >= 0) return groupId;
  }
  return null;
}

function fallbackExternalId_(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (const character of text) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return "mail-" + hash.toString(16).padStart(8, "0");
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
  return activeGroupFromContent_(repeatedlyDecode_(String(content || ""))) !== null;
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

function readProcessedMessages_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PRIXRADAR_PROCESSED_MESSAGES_PROPERTY);
  let parsed = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch (error) { parsed = {}; }
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const entries = Object.keys(parsed).map(function (messageId) {
    return [messageId, Number(parsed[messageId])];
  }).filter(function (entry) {
    return entry[0] && Number.isFinite(entry[1]) && entry[1] >= cutoff;
  }).sort(function (left, right) { return right[1] - left[1]; }).slice(0, PRIXRADAR_MAX_TRACKED_MESSAGES);
  const result = {};
  entries.forEach(function (entry) { result[entry[0]] = entry[1]; });
  return result;
}

function writeProcessedMessages_(messages) {
  const entries = Object.keys(messages).map(function (messageId) {
    return [messageId, Number(messages[messageId])];
  }).filter(function (entry) {
    return entry[0] && Number.isFinite(entry[1]);
  }).sort(function (left, right) { return right[1] - left[1]; }).slice(0, PRIXRADAR_MAX_TRACKED_MESSAGES);
  const compact = {};
  entries.forEach(function (entry) { compact[entry[0]] = entry[1]; });
  PropertiesService.getScriptProperties().setProperty(PRIXRADAR_PROCESSED_MESSAGES_PROPERTY, JSON.stringify(compact));
}
