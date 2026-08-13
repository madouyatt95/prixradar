import { connect } from "cloudflare:sockets";
import PostalMime, { type Address, type Email } from "postal-mime";

import {
  mentionsActiveFacebookGroup,
  parseFacebookEmailContent,
  type FacebookEmailPublication,
} from "@/lib/facebook-email";

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const MAX_SEARCH_RESULTS = 40;
const MAX_EMAIL_BYTES = 512 * 1024;
const MAX_IMAP_RESPONSE_BYTES = 768 * 1024;
const IMAP_TIMEOUT_MS = 12_000;
const TERMINAL_RECEIPT_STATUSES = new Set(["processed", "ignored"]);
const REVIEW_RETRY_MS = 15 * 60_000;

type ImapStatus = "OK" | "NO" | "BAD";

type ImapResponse = {
  bytes: Uint8Array;
  status: ImapStatus;
};

type ReceiptStatus = "processed" | "ignored" | "review";

type PendingPublication = {
  uid: string;
  messageId: string | null;
  publication: FacebookEmailPublication;
};

type PollOptions = {
  database: D1Database;
  user: string;
  appPassword: string;
  now?: Date;
  ingest(sourceId: string, publications: FacebookEmailPublication[]): Promise<void>;
};

export type FacebookGmailPollResult = {
  searched: number;
  fetched: number;
  accepted: number;
  ignored: number;
  review: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(chunks: Uint8Array[], total: number) {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function quoteImap(value: string) {
  if (/[\r\n\0]/u.test(value)) throw new Error("FACEBOOK_GMAIL_CONFIGURATION_INVALID");
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"")}"`;
}

class ImapSession {
  private readonly socket: Socket;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private tagNumber = 0;

  private constructor(socket: Socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  static async open() {
    const socket = connect(
      { hostname: IMAP_HOST, port: IMAP_PORT },
      { secureTransport: "on", allowHalfOpen: true },
    );
    await withTimeout(socket.opened, IMAP_TIMEOUT_MS, "FACEBOOK_GMAIL_CONNECT_TIMEOUT");
    const session = new ImapSession(socket);
    await session.readGreeting();
    return session;
  }

  private async readGreeting() {
    const read = await withTimeout(this.reader.read(), IMAP_TIMEOUT_MS, "FACEBOOK_GMAIL_GREETING_TIMEOUT");
    if (read.done || !/^\* (?:OK|PREAUTH)\b/iu.test(decoder.decode(read.value))) {
      throw new Error("FACEBOOK_GMAIL_GREETING_INVALID");
    }
  }

  private async readResponse(tag: string, maximumBytes: number): Promise<ImapResponse> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const terminal = new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`, "iu");
    while (total <= maximumBytes) {
      const read = await withTimeout(this.reader.read(), IMAP_TIMEOUT_MS, "FACEBOOK_GMAIL_READ_TIMEOUT");
      if (read.done) throw new Error("FACEBOOK_GMAIL_CONNECTION_CLOSED");
      chunks.push(read.value);
      total += read.value.byteLength;
      if (total > maximumBytes) throw new Error("FACEBOOK_GMAIL_RESPONSE_TOO_LARGE");
      const bytes = concat(chunks, total);
      const match = terminal.exec(decoder.decode(bytes));
      if (match) return { bytes, status: match[1].toUpperCase() as ImapStatus };
    }
    throw new Error("FACEBOOK_GMAIL_RESPONSE_TOO_LARGE");
  }

  async command(command: string, label: string, maximumBytes = 128 * 1024) {
    this.tagNumber += 1;
    const tag = `R${String(this.tagNumber).padStart(4, "0")}`;
    await withTimeout(
      this.writer.write(encoder.encode(`${tag} ${command}\r\n`)),
      IMAP_TIMEOUT_MS,
      "FACEBOOK_GMAIL_WRITE_TIMEOUT",
    );
    const response = await this.readResponse(tag, maximumBytes);
    if (response.status !== "OK") throw new Error(label);
    return response.bytes;
  }

  async close() {
    try {
      await this.command("LOGOUT", "FACEBOOK_GMAIL_LOGOUT_FAILED", 32 * 1024);
    } catch {
      // The socket is closed below even if Gmail already ended the session.
    }
    this.reader.releaseLock();
    this.writer.releaseLock();
    await this.socket.close();
  }
}

function imapDate(date: Date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function searchUids(response: Uint8Array) {
  const match = /(?:^|\r\n)\* SEARCH(?: ([0-9 ]+))?\r\n/iu.exec(decoder.decode(response));
  if (!match?.[1]) return [];
  return match[1].trim().split(/\s+/gu).filter((uid) => /^\d{1,20}$/u.test(uid)).slice(-MAX_SEARCH_RESULTS);
}

function messageSize(response: Uint8Array) {
  const match = /RFC822\.SIZE (\d{1,12})/iu.exec(decoder.decode(response));
  const size = Number(match?.[1]);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function responseLiteral(response: Uint8Array) {
  const prefix = decoder.decode(response.subarray(0, Math.min(response.byteLength, 8 * 1024)));
  const marker = /\{(\d{1,9})\}\r\n/u.exec(prefix);
  if (!marker || marker.index === undefined) throw new Error("FACEBOOK_GMAIL_LITERAL_MISSING");
  const length = Number(marker[1]);
  const start = marker.index + marker[0].length;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_EMAIL_BYTES || start + length > response.byteLength) {
    throw new Error("FACEBOOK_GMAIL_LITERAL_INVALID");
  }
  return response.slice(start, start + length);
}

function addressValue(address?: Address) {
  if (!address) return "";
  if ("address" in address && typeof address.address === "string") return address.address;
  return address.group.map((mailbox) => mailbox.address).join(",");
}

function safeMessageId(email: Email) {
  const value = email.messageId?.replace(/[\r\n\0]/gu, "").trim();
  return value ? value.slice(0, 512) : null;
}

async function existingReceipts(database: D1Database, mailbox: string, uids: string[], now: Date) {
  if (uids.length === 0) return new Set<string>();
  const placeholders = uids.map(() => "?").join(",");
  const result = await database.prepare(
    `SELECT uid, status, processed_at AS processedAt FROM facebook_email_receipts WHERE mailbox = ? AND uid IN (${placeholders})`,
  ).bind(mailbox, ...uids).all<{ uid: string; status: string; processedAt: string }>();
  return new Set((result.results ?? [])
    .filter((row) => TERMINAL_RECEIPT_STATUSES.has(row.status)
      || (row.status === "review" && Date.parse(row.processedAt) > now.getTime() - REVIEW_RETRY_MS))
    .map((row) => row.uid));
}

async function recordReceipt(
  database: D1Database,
  input: {
    mailbox: string;
    uid: string;
    messageId: string | null;
    status: ReceiptStatus;
    sourceId?: string | null;
    externalId?: string | null;
    errorCode?: string | null;
    processedAt: string;
  },
) {
  await database.prepare(`
    INSERT INTO facebook_email_receipts(
      mailbox, uid, message_id, status, source_id, external_id, error_code, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mailbox, uid) DO UPDATE SET
      message_id = excluded.message_id,
      status = excluded.status,
      source_id = excluded.source_id,
      external_id = excluded.external_id,
      error_code = excluded.error_code,
      processed_at = excluded.processed_at
  `).bind(
    input.mailbox,
    input.uid,
    input.messageId,
    input.status,
    input.sourceId ?? null,
    input.externalId ?? null,
    input.errorCode ?? null,
    input.processedAt,
  ).run();
}

async function parseMessage(raw: Uint8Array, now: Date) {
  const email = await PostalMime.parse(raw, {
    maxHeadersSize: 64 * 1024,
    maxNestingDepth: 20,
    maxRfc822NestingDepth: 2,
  });
  const from = addressValue(email.from || email.sender);
  const date = new Date(email.date ?? "");
  const subject = email.subject ?? "";
  const text = email.text ?? "";
  const html = email.html ?? "";
  return {
    email,
    publication: parseFacebookEmailContent({ from, subject, text, html, date }, now),
    mentionsActiveGroup: mentionsActiveFacebookGroup(`${subject}\n${text}\n${html}`),
  };
}

export async function pollFacebookGmail(options: PollOptions): Promise<FacebookGmailPollResult> {
  const user = options.user.trim().toLowerCase();
  const password = options.appPassword.replace(/\s+/gu, "");
  if (!/^[^\s@]+@gmail\.com$/iu.test(user) || password.length < 16 || password.length > 64) {
    throw new Error("FACEBOOK_GMAIL_CONFIGURATION_INVALID");
  }

  const now = options.now ?? new Date();
  const session = await ImapSession.open();
  const summary: FacebookGmailPollResult = { searched: 0, fetched: 0, accepted: 0, ignored: 0, review: 0 };
  try {
    await session.command(`LOGIN ${quoteImap(user)} ${quoteImap(password)}`, "FACEBOOK_GMAIL_AUTH_FAILED");
    await session.command("EXAMINE INBOX", "FACEBOOK_GMAIL_INBOX_FAILED");
    const since = new Date(now.getTime() - 2 * 86_400_000);
    const search = await session.command(
      `UID SEARCH SINCE ${imapDate(since)} FROM ${quoteImap("facebookmail.com")}`,
      "FACEBOOK_GMAIL_SEARCH_FAILED",
      256 * 1024,
    );
    const uids = searchUids(search);
    summary.searched = uids.length;
    const processed = await existingReceipts(options.database, user, uids, now);
    const pendingBySource = new Map<string, PendingPublication[]>();

    for (const uid of uids) {
      if (processed.has(uid)) continue;
      const sizeResponse = await session.command(
        `UID FETCH ${uid} (RFC822.SIZE)`,
        "FACEBOOK_GMAIL_SIZE_FAILED",
        32 * 1024,
      );
      const size = messageSize(sizeResponse);
      if (size === null || size > MAX_EMAIL_BYTES) {
        await recordReceipt(options.database, {
          mailbox: user,
          uid,
          messageId: null,
          status: "ignored",
          errorCode: size === null ? "MESSAGE_SIZE_INVALID" : "MESSAGE_TOO_LARGE",
          processedAt: now.toISOString(),
        });
        summary.ignored += 1;
        continue;
      }

      const fetchResponse = await session.command(
        `UID FETCH ${uid} (BODY.PEEK[])`,
        "FACEBOOK_GMAIL_FETCH_FAILED",
        MAX_IMAP_RESPONSE_BYTES,
      );
      summary.fetched += 1;
      const parsed = await parseMessage(responseLiteral(fetchResponse), now);
      const messageId = safeMessageId(parsed.email);
      if (!parsed.publication) {
        const status: ReceiptStatus = parsed.mentionsActiveGroup ? "review" : "ignored";
        await recordReceipt(options.database, {
          mailbox: user,
          uid,
          messageId,
          status,
          errorCode: parsed.mentionsActiveGroup ? "FACEBOOK_EMAIL_UNPARSED" : null,
          processedAt: now.toISOString(),
        });
        if (status === "review") summary.review += 1;
        else summary.ignored += 1;
        continue;
      }
      const group = pendingBySource.get(parsed.publication.sourceId) ?? [];
      group.push({ uid, messageId, publication: parsed.publication });
      pendingBySource.set(parsed.publication.sourceId, group);
    }

    for (const [sourceId, pending] of pendingBySource) {
      await options.ingest(sourceId, pending.map((item) => item.publication));
      for (const item of pending) {
        await recordReceipt(options.database, {
          mailbox: user,
          uid: item.uid,
          messageId: item.messageId,
          status: "processed",
          sourceId: item.publication.sourceId,
          externalId: item.publication.externalId,
          processedAt: now.toISOString(),
        });
        summary.accepted += 1;
      }
    }
    return summary;
  } finally {
    try {
      await session.close();
    } catch {
      console.warn(JSON.stringify({ event: "facebook_gmail_connection_close_failed" }));
    }
  }
}
