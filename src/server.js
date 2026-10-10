import { timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_LENGTH = 4096;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

class TelegramError extends Error {}

function isAuthorized(request, apiKey) {
  const authorization = request.headers.authorization ?? "";
  const match = /^Bearer (.+)$/i.exec(authorization);

  if (!match) {
    return false;
  }

  const providedKey = Buffer.from(match[1]);
  const expectedKey = Buffer.from(apiKey);

  return providedKey.length === expectedKey.length
    && timingSafeEqual(providedKey, expectedKey);
}

async function readJsonBody(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  const chunks = [];
  let bodySize = 0;

  for await (const chunk of request) {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function validatePayload(payload, defaultChatId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  if (payload.type !== "text") {
    throw new HttpError(400, 'type must be "text"');
  }

  if (typeof payload.message !== "string" || payload.message.trim().length === 0) {
    throw new HttpError(400, "message must be a non-empty string");
  }

  if (payload.message.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(400, `message must be at most ${MAX_MESSAGE_LENGTH} characters`);
  }

  const chatId = payload.chat_id ?? defaultChatId;
  if ((typeof chatId !== "string" && typeof chatId !== "number") || String(chatId).trim() === "") {
    throw new HttpError(400, "chat_id must be a non-empty string or number");
  }

  if (payload.parse_mode !== undefined && !["HTML", "Markdown", "MarkdownV2"].includes(payload.parse_mode)) {
    throw new HttpError(400, "parse_mode must be HTML, Markdown, or MarkdownV2");
  }

  return {
    chat_id: chatId,
    text: payload.message,
    ...(payload.parse_mode ? { parse_mode: payload.parse_mode } : {}),
    ...(typeof payload.disable_notification === "boolean"
      ? { disable_notification: payload.disable_notification }
      : {}),
  };
}

async function sendTelegramMessage(botToken, messagePayload, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(messagePayload),
    });
  } catch (error) {
    throw new TelegramError(`Could not reach Telegram: ${error.message}`);
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new TelegramError("Telegram returned an invalid response");
  }

  if (!response.ok || result.ok !== true) {
    throw new TelegramError(result.description ?? "Telegram rejected the message");
  }

  return result.result;
}

function isStartCommand(message) {
  return typeof message?.text === "string"
    && /^\/start(?:@\w+)?(?:\s|$)/i.test(message.text);
}

export function formatStartGreeting(message) {
  const user = message.from ?? {};
  const name = [user.first_name, user.last_name]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ") || "di sana";

  if (message.chat?.type !== "private") {
    return `Halo, ${name}! 👋 DevLabHub siap membantu.`;
  }

  const details = [
    `Nama: ${name}`,
    `Username: ${user.username ? `@${user.username}` : "tidak diatur"}`,
    `User ID: ${user.id ?? "tidak tersedia"}`,
    `Chat ID: ${message.chat.id ?? "tidak tersedia"}`,
    `Bahasa: ${user.language_code ?? "tidak tersedia"}`,
  ];

  return [
    `Halo, ${name}! 👋`,
    "DevLabHub siap mengirim notifikasi pesanan ke chat ini.",
    "",
    "Info profil yang Telegram bagikan:",
    ...details,
    "",
    "Telegram tidak membagikan nomor telepon atau email lewat /start.",
  ].join("\n");
}

export async function runTelegramPolling({
  botToken,
  fetchImpl = fetch,
  signal,
  logger = console,
}) {
  let offset;

  while (!signal.aborted) {
    try {
      const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
      url.searchParams.set("timeout", "25");
      if (offset !== undefined) {
        url.searchParams.set("offset", String(offset));
      }

      const response = await fetchImpl(url, { signal });
      const result = await response.json();

      if (!response.ok || result.ok !== true || !Array.isArray(result.result)) {
        throw new TelegramError(result.description ?? "Telegram getUpdates failed");
      }

      for (const update of result.result) {
        offset = update.update_id + 1;
        if (!isStartCommand(update.message)) {
          continue;
        }

        try {
          await sendTelegramMessage(botToken, {
            chat_id: update.message.chat.id,
            text: formatStartGreeting(update.message),
          }, fetchImpl);
        } catch (error) {
          logger.error(`Could not send /start greeting: ${error.message}`);
        }
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      logger.error(`Telegram polling failed: ${error.message}`);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  }
}

export function createServer({
  apiKey,
  botToken,
  fetchImpl = fetch,
}) {
  if (!apiKey || apiKey.length < 16) {
    throw new Error("API_KEY must be set and at least 16 characters long");
  }
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN must be set");
  }
  return createHttpServer(async (request, response) => {
    const respond = (statusCode, data) => {
      response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(data));
    };

    if (request.method === "GET" && request.url === "/health") {
      respond(200, { status: "ok" });
      return;
    }

    if (request.method !== "POST" || request.url !== "/send") {
      respond(404, { error: "Not found" });
      return;
    }

    if (!isAuthorized(request, apiKey)) {
      respond(401, { error: "Unauthorized" });
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const headerChatId = request.headers["x-telegram-chat-id"];
      const messagePayload = validatePayload(payload, headerChatId);
      const sentMessage = await sendTelegramMessage(botToken, messagePayload, fetchImpl);

      respond(200, {
        ok: true,
        message_id: sentMessage.message_id,
        chat_id: sentMessage.chat.id,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        respond(error.statusCode, { error: error.message });
        return;
      }

      if (error instanceof TelegramError) {
        console.error(`Telegram send failed: ${error.message}`);
        respond(502, { error: error.message });
        return;
      }

      console.error("Unexpected error while sending Telegram message:", error);
      respond(500, { error: "Internal server error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createServer({
    apiKey: process.env.API_KEY,
    botToken: process.env.TELEGRAM_BOT_TOKEN,
  });
  const port = Number(process.env.PORT ?? 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  server.listen(port, () => {
    console.log(`DevLabHub Telegram bot endpoint listening on port ${port}`);
  });

  const pollingController = new AbortController();
  void runTelegramPolling({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    signal: pollingController.signal,
  });

  const shutdown = () => {
    pollingController.abort();
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
