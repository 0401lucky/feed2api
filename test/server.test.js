import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveChatGraphqlEndpoint,
  extractAssistantText,
  normalizeContent,
  normalizeMessages,
} from "../src/server.js";

test("合并 OpenAI 消息为 PromptQL 单轮输入", () => {
  const prompt = normalizeMessages([
    { role: "system", content: "你是角色扮演助手。" },
    { role: "user", content: "你好" },
  ]);

  assert.equal(
    prompt,
    "SYSTEM:\n你是角色扮演助手。\n\nUSER:\n你好",
  );
});

test("支持 OpenAI 多段文本 content", () => {
  const content = normalizeContent([
    { type: "text", text: "第一段" },
    { type: "text", text: "第二段" },
    { type: "image_url", image_url: { url: "https://example.com/a.png" } },
  ]);

  assert.equal(content, "第一段\n第二段");
});

test("拒绝空 messages", () => {
  assert.throws(
    () => normalizeMessages([{ role: "user", content: "" }]),
    /没有可发送的文本内容/,
  );
});

test("从事件列表里提取助手回复", () => {
  const text = extractAssistantText([
    {
      thread_event_id: 1,
      user_id: "user-1",
      event_data: { role: "user", content: "你好" },
    },
    {
      thread_event_id: 2,
      user_id: null,
      event_data: {
        type: "assistant_message",
        message: { content: "你好，我在。" },
      },
    },
  ]);

  assert.equal(text, "你好，我在。");
});

test("派生 PromptQL v2 聊天 GraphQL 端点", () => {
  assert.equal(
    deriveChatGraphqlEndpoint("https://playground.promptql.pro.hasura.io/"),
    "https://playground.promptql.pro.hasura.io-v2-hge/v1/graphql",
  );
});
