import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const config = {
  port: toPositiveInt(process.env.PORT, 3000),
  apiKey: process.env.API_KEY || "",
  promptqlToken: process.env.PROMPTQL_TOKEN || "",
  promptqlAuthHeader: process.env.PROMPTQL_AUTH_HEADER || "authorization",
  promptqlAuthScheme: process.env.PROMPTQL_AUTH_SCHEME ?? "pat",
  webhookBaseUrl:
    process.env.PROMPTQL_WEBHOOK_BASE_URL ||
    "https://data.prompt.ql.app/promptql/playground-v2",
  chatGraphqlEndpoint:
    process.env.PROMPTQL_CHAT_GRAPHQL_ENDPOINT ||
    "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql",
  projectName: process.env.PROMPTQL_PROJECT_NAME || "p-8969d7e6-d5df",
  projectId:
    process.env.PROMPTQL_PROJECT_ID ||
    "8969d7e6-d5df-4046-9d23-7d0815eb7823",
  roomName: process.env.PROMPTQL_ROOM_NAME || "general",
  roomId: process.env.PROMPTQL_ROOM_ID || "",
  roomless: toBoolean(process.env.PROMPTQL_ROOMLESS, false),
  pollIntervalMs: toPositiveInt(process.env.PROMPTQL_POLL_INTERVAL_MS, 1200),
  timeoutMs: toPositiveInt(process.env.PROMPTQL_TIMEOUT_MS, 120000),
  requestTimeoutMs: toPositiveInt(process.env.PROMPTQL_REQUEST_TIMEOUT_MS, 30000),
  maxEvents: toPositiveInt(process.env.PROMPTQL_MAX_EVENTS, 200),
  webhookMaxPromptChars: toPositiveInt(
    process.env.PROMPTQL_WEBHOOK_MAX_PROMPT_CHARS,
    6000,
  ),
};

const state = {
  promptqlContextPromise: null,
};

const ROOMS_QUERY = `
query getRoomsByProjectId($projectID: uuid!) {
  rooms(where: {project_id: {_eq: $projectID}, deleted_at: {_is_null: true}}) {
    room_id
    name
    visibility
    project_id
  }
}
`;

const THREAD_EVENTS_QUERY = `
query getThreadEvents($thread_id: uuid, $after_event_id: bigint!, $limit: Int = null) {
  thread_events(
    where: {thread_id: {_eq: $thread_id}, thread_event_id: {_gt: $after_event_id}}
    order_by: {thread_event_id: asc}
    limit: $limit
  ) {
    thread_event_id
    thread_id
    event_data
    created_at
  }
}
`;

const GRAPHQL_HEALTH_QUERY = `
query HealthCheck {
  __typename
}
`;

function toPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function toBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function deriveChatGraphqlEndpoint(playgroundHost) {
  const host = String(playgroundHost || "").replace(/\/+$/, "");
  return `${host}-v2-hge/v1/graphql`;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function jsonResponse(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function errorResponse(res, statusCode, message, details) {
  jsonResponse(res, statusCode, {
    error: {
      message,
      type: "feed2api_error",
      details,
    },
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        const err = new Error("请求体过大");
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (err) => {
      if (err?.code === "ECONNRESET") {
        const resetErr = new Error("请求连接已中断");
        resetErr.statusCode = 400;
        reject(resetErr);
        return;
      }
      reject(err);
    });
  });
}

function assertAuthorized(req) {
  if (!config.apiKey) return;
  const header = req.headers.authorization || "";
  if (header !== `Bearer ${config.apiKey}` && header !== config.apiKey) {
    const err = new Error("API Key 不正确");
    err.statusCode = 401;
    throw err;
  }
}

async function graphqlRequest(endpoint, query, variables = {}, label = "PromptQL") {
  if (!config.promptqlToken) {
    throw new Error("缺少 PROMPTQL_TOKEN 环境变量");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...promptqlAuthHeaders(),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`${label} 请求超时：${config.requestTimeoutMs}ms`);
    }
    throw new Error(`${label} 请求失败：${err.message || String(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} 返回了非 JSON 响应：${text.slice(0, 300)}`);
  }

  if (!response.ok || payload.errors?.length) {
    const message =
      payload.errors?.map((item) => item.message).join("\n") ||
      `${label} 请求失败：HTTP ${response.status}`;
    const err = new Error(`${label} 错误：${message}`);
    err.statusCode = response.ok ? graphQLErrorStatus(payload.errors) : response.status || 502;
    err.promptql = payload;
    throw err;
  }

  return payload.data;
}

function promptqlAuthHeaders() {
  const value = config.promptqlAuthScheme
    ? `${config.promptqlAuthScheme} ${config.promptqlToken}`
    : config.promptqlToken;
  return {
    [config.promptqlAuthHeader]: value,
  };
}

async function promptqlWebhookRequest(url, body) {
  if (!config.promptqlToken) {
    throw new Error("缺少 PROMPTQL_TOKEN 环境变量");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...promptqlAuthHeaders(),
        ...(body ? { "content-type": "text/plain; charset=utf-8" } : {}),
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`PromptQL Webhook 请求超时：${config.requestTimeoutMs}ms`);
    }
    throw new Error(`PromptQL Webhook 请求失败：${err.message || String(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`PromptQL Webhook 返回了非 JSON 响应：${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    const message = payload.error || payload.detail || `HTTP ${response.status}`;
    const err = new Error(`PromptQL Webhook 错误：${message}`);
    err.statusCode = response.status || 502;
    err.promptql = payload;
    throw err;
  }

  return payload;
}

function graphQLErrorStatus(errors = []) {
  const codes = errors
    .map((item) => item?.extensions?.code)
    .filter((code) => typeof code === "string");
  if (codes.some((code) => ["access-denied", "invalid-jwt", "invalid-headers"].includes(code))) {
    return 401;
  }
  if (codes.some((code) => ["validation-failed", "parse-failed"].includes(code))) {
    return 502;
  }
  return 502;
}

async function getPromptqlContext() {
  if (!state.promptqlContextPromise) {
    state.promptqlContextPromise = resolvePromptqlContext();
  }
  try {
    return await state.promptqlContextPromise;
  } catch (err) {
    state.promptqlContextPromise = null;
    throw err;
  }
}

async function resolvePromptqlContext() {
  if (config.roomless) {
    throw new Error(
      "Webhook 模式不支持 PROMPTQL_ROOMLESS=true，请设置 PROMPTQL_ROOMLESS=false 并配置房间",
    );
  }

  if (!config.projectId) {
    throw new Error("缺少 PROMPTQL_PROJECT_ID 环境变量");
  }

  let roomId = config.roomId || "";
  if (!roomId && config.roomName) {
    const roomData = await graphqlRequest(
      config.chatGraphqlEndpoint,
      ROOMS_QUERY,
      {
        projectID: config.projectId,
      },
      "PromptQL 聊天",
    );
    const rooms = roomData.rooms || [];
    const room = rooms.find((item) => item.name === config.roomName);
    if (!room?.room_id) {
      const names = rooms.map((item) => item.name).join(", ");
      throw new Error(
        `找不到房间：${config.roomName}。当前可见房间：${names || "无"}`,
      );
    }
    roomId = room.room_id;
  }

  if (!roomId) {
    throw new Error("缺少 PROMPTQL_ROOM_ID，且无法通过 PROMPTQL_ROOM_NAME 找到房间");
  }

  return {
    projectId: config.projectId,
    projectName: config.projectName,
    roomId,
    roomName: config.roomName || undefined,
    roomless: false,
  };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages 必须是非空数组");
  }

  const prompt = messages
    .map((message) => {
      const role = message.role || "user";
      const content = normalizeContent(message.content);
      if (!content.trim()) return "";
      return `${role.toUpperCase()}:\n${content.trim()}`;
    })
    .filter(Boolean)
    .join("\n\n");

  if (!prompt.trim()) {
    const err = new Error("messages 没有可发送的文本内容");
    err.statusCode = 400;
    throw err;
  }

  return prompt;
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  return String(content);
}

async function createPromptqlThread(message) {
  const context = await getPromptqlContext();
  const base = trimTrailingSlash(config.webhookBaseUrl);
  const url = new URL(
    `${base}/hooks/room/${encodeURIComponent(context.roomId)}/send_message`,
  );

  let body;
  if (message.length > config.webhookMaxPromptChars) {
    url.searchParams.set("prompt", "请根据请求正文中的对话内容继续回复。");
    body = message;
  } else {
    url.searchParams.set("prompt", message);
  }
  url.searchParams.set("ask_promptql", "true");

  const data = await promptqlWebhookRequest(url, body);
  if (!data.thread_id) {
    throw new Error("PromptQL 没有返回 thread_id");
  }

  return {
    thread_id: data.thread_id,
    thread_events: [],
    initial_event_id: Number(data.message_id || 0),
    hook_message_id: data.message_id,
  };
}

async function waitForAssistantText(thread, startedAt = Date.now()) {
  let events = Array.isArray(thread.thread_events) ? thread.thread_events : [];
  let afterEventId = Math.max(maxEventId(events), Number(thread.initial_event_id || 0));
  let best = extractAssistantText(events);
  if (best) return { text: best, events };

  while (Date.now() - startedAt < config.timeoutMs) {
    await sleep(config.pollIntervalMs);

    const data = await graphqlRequest(
      config.chatGraphqlEndpoint,
      THREAD_EVENTS_QUERY,
      {
        thread_id: thread.thread_id,
        after_event_id: String(afterEventId || 0),
        limit: config.maxEvents,
      },
      "PromptQL 聊天",
    );

    const nextEvents = data.thread_events || [];
    if (nextEvents.length > 0) {
      events = events.concat(nextEvents);
      afterEventId = maxEventId(events);
      const promptqlError = extractPromptqlError(events);
      if (promptqlError) {
        const err = new Error(promptqlError);
        err.statusCode = 502;
        err.events = events;
        throw err;
      }
      best = extractAssistantText(events);
      if (best) return { text: best, events };
    }
  }

  const err = new Error("等待 PromptQL 回复超时");
  err.events = events;
  throw err;
}

function maxEventId(events) {
  return events.reduce((max, event) => {
    const value = Number(event.thread_event_id || 0);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
}

function extractAssistantText(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const eventData = events[index].event_data;
    if (looksLikeUserEvent(eventData, events[index])) continue;
    const text = extractPromptqlAgentText(eventData);
    if (text) return text;
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const eventData = events[index].event_data;
    if (looksLikeUserEvent(eventData, events[index]) || eventData?.AgentMessage) continue;
    const text = extractTextFromValue(eventData);
    if (text) return text;
  }

  return "";
}

function looksLikeUserEvent(value, event) {
  if (value?.UserMessage || event?.user_id) return true;
  const json = safeLowerJson(value);
  return (
    json.includes('"user"') &&
    !json.includes("assistant") &&
    !json.includes("agent")
  );
}

function extractPromptqlAgentText(value) {
  const update = value?.AgentMessage?.update;
  if (!update || typeof update !== "object") return "";

  const responseGeneration =
    update.ResponseGenerationUpdate?.update?.GeneratedResponse?.response?.message;
  if (typeof responseGeneration === "string" && responseGeneration.trim()) {
    return responseGeneration.trim();
  }

  const orchestrator =
    update.OrchestratorUpdate?.update?.GeneratedResponse?.response?.message;
  if (typeof orchestrator === "string" && orchestrator.trim()) {
    return orchestrator.trim();
  }

  const mainAgent = update.content?.interaction_update?.main_agent;
  const completedSummary = mainAgent?.completed?.summary;
  if (typeof completedSummary === "string" && completedSummary.trim()) {
    return completedSummary.trim();
  }

  const actionResult = mainAgent?.action_completed?.result;
  if (
    actionResult?.agent_loop_action_result_type === "final_response_sent" &&
    typeof actionResult.message === "string" &&
    actionResult.message.trim()
  ) {
    return actionResult.message.trim();
  }

  return "";
}

function extractPromptqlError(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const outcome =
      events[index].event_data?.AgentMessage?.update?.content?.interaction_finished
        ?.outcome;
    const errored = outcome?.errored;
    const message = errored?.user_facing_message || errored?.raw_error;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "";
}

function safeLowerJson(value) {
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return "";
  }
}

function extractTextFromValue(value, depth = 0, seen = new Set()) {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") {
    return cleanCandidateText(value);
  }
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const directKeys = [
    "content",
    "text",
    "message",
    "answer",
    "response",
    "output",
    "markdown",
    "summary",
    "llm_output",
  ];

  for (const key of directKeys) {
    const direct = value[key];
    const text = extractTextFromValue(direct, depth + 1, seen);
    if (text) return text;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractTextFromValue(item, depth + 1, seen))
      .filter(Boolean);
    return cleanCandidateText(parts.join("\n"));
  }

  const parts = [];
  for (const [key, child] of Object.entries(value)) {
    if (shouldSkipTextKey(key)) continue;
    const text = extractTextFromValue(child, depth + 1, seen);
    if (text) parts.push(text);
  }
  return cleanCandidateText(parts.join("\n"));
}

function shouldSkipTextKey(key) {
  const normalized = key.toLowerCase();
  return [
    "id",
    "uuid",
    "thread_id",
    "thread_event_id",
    "created_at",
    "updated_at",
    "user_id",
    "promptql_user_id",
    "role",
    "type",
    "__typename",
  ].includes(normalized);
}

function cleanCandidateText(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (/^[0-9a-f-]{20,}$/i.test(value)) return "";
  if (/^\d+$/.test(value)) return "";
  if (/^\d{4}-\d{2}-\d{2}t/i.test(value)) return "";
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleChatCompletions(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    const err = new Error("请求体不是合法 JSON");
    err.statusCode = 400;
    throw err;
  }
  const model = body.model || "promptql-roleplay";
  const prompt = normalizeMessages(body.messages);
  const thread = await createPromptqlThread(prompt);
  const result = await waitForAssistantText(thread);
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-${randomUUID()}`;

  if (body.stream) {
    writeOpenAiStream(res, id, model, created, result.text);
    return;
  }

  jsonResponse(res, 200, {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: result.text,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    promptql: {
      thread_id: thread.thread_id,
      hook_message_id: thread.hook_message_id || null,
      event_count: result.events.length,
    },
  });
}

async function handleReady(_req, res) {
  const context = await getPromptqlContext();
  await graphqlRequest(
    config.chatGraphqlEndpoint,
    GRAPHQL_HEALTH_QUERY,
    {},
    "PromptQL 聊天",
  );

  jsonResponse(res, 200, {
    ok: true,
    service: "feed2api",
    promptql: {
      project_id: context.projectId,
      project_name: context.projectName,
      room_id: context.roomId,
      room_name: context.roomName || null,
      roomless: context.roomless,
      webhook_base_url: config.webhookBaseUrl,
      chat_graphql_endpoint: config.chatGraphqlEndpoint,
    },
  });
}

function writeOpenAiStream(res, id, model, created, text) {
  res.writeHead(200, {
    ...corsHeaders(),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  const chunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: text,
        },
        finish_reason: null,
      },
    ],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`,
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      jsonResponse(res, 200, {
        ok: true,
        service: "feed2api",
        mode: "openai-compatible-chat",
      }, corsHeaders());
      return;
    }

    if (req.method === "GET" && url.pathname === "/ready") {
      assertAuthorized(req);
      await handleReady(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      assertAuthorized(req);
      jsonResponse(res, 200, {
        object: "list",
        data: [
          {
            id: "promptql-roleplay",
            object: "model",
            created: 0,
            owned_by: "promptql",
          },
        ],
      }, corsHeaders());
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      assertAuthorized(req);
      await handleChatCompletions(req, res);
      return;
    }

    errorResponse(res, 404, "接口不存在");
  } catch (err) {
    const statusCode = err.statusCode && err.statusCode < 600 ? err.statusCode : 500;
    errorResponse(res, statusCode, err.message || "服务异常", err.promptql);
  }
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}

function createServer() {
  return http.createServer(handleRequest);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const server = createServer();
  server.listen(config.port, () => {
    console.log(`feed2api listening on :${config.port}`);
  });
}

export {
  createServer,
  deriveChatGraphqlEndpoint,
  extractAssistantText,
  extractPromptqlAgentText,
  normalizeContent,
  normalizeMessages,
};
