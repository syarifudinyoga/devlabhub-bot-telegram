import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStartGreeting, runTelegramPolling } from "../src/server.js";

test("replies with a greeting when a user sends /start", async () => {
  const controller = new AbortController();
  const requests = [];
  const logger = { error: (message) => assert.fail(message) };

  const fetchImpl = async (url, options) => {
    const requestUrl = new URL(url);
    requests.push({ url: requestUrl, options });

    if (requestUrl.pathname.endsWith("/getUpdates")) {
      return new Response(JSON.stringify({
        ok: true,
        result: [{
          update_id: 42,
          message: {
            text: "/start",
            from: {
              id: 123456,
              first_name: "Dina",
              last_name: "Putri",
              username: "dinap",
              language_code: "id",
            },
            chat: { id: 123456, type: "private" },
          },
        }],
      }), { status: 200 });
    }

    controller.abort();
    assert.match(requestUrl.pathname, /sendMessage$/);
    assert.deepEqual(JSON.parse(options.body), {
      chat_id: 123456,
      text: [
        "Halo, Dina Putri! 👋",
        "DevLabHub siap mengirim notifikasi pesanan ke chat ini.",
        "",
        "Info profil yang Telegram bagikan:",
        "Nama: Dina Putri",
        "Username: @dinap",
        "User ID: 123456",
        "Chat ID: 123456",
        "Bahasa: id",
        "",
        "Telegram tidak membagikan nomor telepon atau email lewat /start.",
      ].join("\n"),
    });
    return new Response(JSON.stringify({
      ok: true,
      result: { message_id: 1, chat: { id: 123456 } },
    }), { status: 200 });
  };

  await runTelegramPolling({
    botToken: "test-bot-token",
    fetchImpl,
    signal: controller.signal,
    logger,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.searchParams.get("timeout"), "25");
});

test("does not expose user IDs in a group greeting", () => {
  const greeting = formatStartGreeting({
    from: { id: 987, first_name: "Raka", username: "raka" },
    chat: { id: -123, type: "group" },
  });

  assert.equal(greeting, "Halo, Raka! 👋 DevLabHub siap membantu.");
  assert.doesNotMatch(greeting, /987|-123|@raka/);
});
