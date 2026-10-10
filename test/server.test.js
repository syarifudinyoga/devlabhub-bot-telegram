import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createServer } from "../src/server.js";

const apiKey = "test-secret-key-with-adequate-length";
let server;
let endpoint;
let sentPayload;

describe("DevLabHub send endpoint", () => {
  before(async () => {
    server = createServer({
      apiKey,
      botToken: "test-bot-token",
      fetchImpl: async (_url, options) => {
        sentPayload = JSON.parse(options.body);
        return new Response(JSON.stringify({
          ok: true,
          result: { message_id: 123, chat: { id: sentPayload.chat_id } },
        }), { status: 200 });
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  test("sends a text message to the chat selected in the payload", async () => {
    const response = await fetch(`${endpoint}/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "text",
        chat_id: "payload-chat-id",
        message: "Hello from DevLabHub",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      message_id: 123,
      chat_id: "payload-chat-id",
    });
    assert.deepEqual(sentPayload, {
      chat_id: "payload-chat-id",
      text: "Hello from DevLabHub",
    });
  });

  test("allows an authenticated payload to override chat and text options", async () => {
    const response = await fetch(`${endpoint}/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "text",
        chat_id: 987654,
        message: "<b>Custom message</b>",
        parse_mode: "HTML",
        disable_notification: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(sentPayload, {
      chat_id: 987654,
      text: "<b>Custom message</b>",
      parse_mode: "HTML",
      disable_notification: true,
    });
  });

  test("allows the recipient to be set with a header", async () => {
    const response = await fetch(`${endpoint}/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-telegram-chat-id": "header-chat-id",
      },
      body: JSON.stringify({ type: "text", message: "Header recipient" }),
    });

    assert.equal(response.status, 200);
    assert.equal(sentPayload.chat_id, "header-chat-id");
  });

  test("payload chat_id takes precedence over the recipient header", async () => {
    const response = await fetch(`${endpoint}/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-telegram-chat-id": "header-chat-id",
      },
      body: JSON.stringify({
        type: "text",
        chat_id: "payload-chat-id",
        message: "Payload recipient",
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(sentPayload.chat_id, "payload-chat-id");
  });

  test("requires a chat ID in the payload or header", async () => {
    const response = await fetch(`${endpoint}/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "text", message: "Missing recipient" }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "chat_id must be a non-empty string or number",
    });
  });

  test("rejects unauthorized and unsupported payloads", async () => {
    const unauthorized = await fetch(`${endpoint}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "text", message: "No auth" }),
    });
    assert.equal(unauthorized.status, 401);

    const unsupported = await fetch(`${endpoint}/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "photo", message: "not supported yet" }),
    });
    assert.equal(unsupported.status, 400);
    assert.deepEqual(await unsupported.json(), { error: 'type must be "text"' });
  });
});
