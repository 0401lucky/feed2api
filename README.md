# feed2API

给 SillyTavern / new-api 用的 PromptQL 聊天代理。

它提供 OpenAI 兼容接口，底层用 PromptQL GraphQL 创建线程、轮询回复，并支持读取 PromptQL 真实模型列表。

- `GET /health`：进程健康检查
- `GET /ready`：检查 PromptQL 配置和上游连通性
- `GET /v1/models`：OpenAI 兼容模型列表
- `GET /models`：兼容部分中转面板的模型列表路径
- `POST /v1/chat/completions`：OpenAI 兼容聊天接口

不支持工具调用、函数调用、多模态上传。角色扮演聊天够用。


## 1. 已确认的 PromptQL 配置

这次已经用你的登录账号真实确认过：

```bash
PROMPTQL_PROJECT_NAME=p-8969d7e6-d5df
PROMPTQL_PROJECT_ID=8969d7e6-d5df-4046-9d23-7d0815eb7823
PROMPTQL_ROOM_NAME=general
PROMPTQL_ROOM_ID=bc6ffc31-1441-4adc-bac8-e375a5671be4
PROMPTQL_CHAT_GRAPHQL_ENDPOINT=https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql
```

默认使用 `PROMPTQL_ROOMLESS=true`，适合角色扮演，不会把 SillyTavern 对话刷到 `general` 房间。

如果你想让对话进入 `general` 房间，再改成：

```bash
PROMPTQL_ROOMLESS=false
PROMPTQL_ROOM_ID=bc6ffc31-1441-4adc-bac8-e375a5671be4
```


## 2. 获取 PromptQL Token

不要复制浏览器 Cookie、localStorage 或网页登录态。

使用 PromptQL 的 Personal Access Token：

1. 打开 `https://prompt.ql.app/project/p-8969d7e6-d5df/user-directory/members/baa57f2d-141e-44b0-89fb-614ae19d1a32`
2. 页面下方找到 `Personal Access Tokens`
3. 点击 `New token`
4. `Token name` 填 `feed2api-zeabur`
5. `Scope` 保持 `Unrestricted`
6. 点击 `Create token`
7. 复制以 `pql_ut_` 开头的 token

token 只会完整显示一次。你当前浏览器页面已经生成了一个 token，
页面上正在显示完整值，可以直接复制到 Zeabur。


## 3. 模型列表

代理会用 `PROMPTQL_TOKEN` 自动读取 PromptQL 的 `llm_config`。

当前真实读取到的模型包括：

```text
Claude Opus 4.8
Claude Sonnet 4.5
DeepSeek V4 Pro
Gemini 3.1 Pro Preview
Gemini 3.5 Flash
GLM 5.2
GPT 5.5
Kimi K2.6
Kimi K2.7 Code
Minimax M3
```

客户端或 new-api 传入这些模型名时，代理会自动映射到 PromptQL 的 `llmConfigId`。

如果读取 PromptQL 模型失败，会回退到 `MODELS` 环境变量：

```bash
MODELS=promptql-roleplay
DEFAULT_MODEL=
```


## 4. Zeabur 部署

### 4.1 从 GitHub 部署

1. 打开 Zeabur
2. 新建 Project
3. 选择从 GitHub 导入
4. 选择仓库 `0401lucky/feed2api`
5. 部署方式选 Dockerfile

仓库已经带了 `Dockerfile`，不需要额外构建命令。


### 4.2 环境变量

最小必填：

```bash
API_KEY=给 SillyTavern 或 new-api 填的代理密钥
PROMPTQL_TOKEN=你的 pql_ut_ token
PROMPTQL_PROJECT_ID=8969d7e6-d5df-4046-9d23-7d0815eb7823
```

建议完整填写：

```bash
PROMPTQL_PROJECT_NAME=p-8969d7e6-d5df
PROMPTQL_ROOMLESS=true
PROMPTQL_ROOM_NAME=general
PROMPTQL_ROOM_ID=bc6ffc31-1441-4adc-bac8-e375a5671be4
PROMPTQL_CHAT_GRAPHQL_ENDPOINT=https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql
PROMPTQL_AUTH_HEADER=authorization
PROMPTQL_AUTH_SCHEME=pat
PROMPTQL_TIMEZONE=Asia/Shanghai
PROMPTQL_FETCH_MODELS=true
PROMPTQL_MODEL_CACHE_TTL_MS=300000
MODELS=promptql-roleplay
DEFAULT_MODEL=
MODEL_OWNER=promptql
PROMPTQL_TIMEOUT_MS=120000
PROMPTQL_REQUEST_TIMEOUT_MS=30000
PROMPTQL_POLL_INTERVAL_MS=1200
PROMPTQL_MAX_EVENTS=200
```


### 4.3 端口和挂载卷

不用改端口。服务会读取 Zeabur 自动注入的 `PORT`，本地默认 `3000`。

不需要挂载卷。服务无状态，不保存聊天记录、不写数据库。


## 5. 部署后检查

假设 Zeabur 域名是：

```text
https://feed2api.example.zeabur.app
```

检查进程：

```bash
curl https://feed2api.example.zeabur.app/health
```

检查 PromptQL 配置：

```bash
curl https://feed2api.example.zeabur.app/ready \
  -H "authorization: Bearer 你设置的 API_KEY"
```

检查模型：

```bash
curl https://feed2api.example.zeabur.app/v1/models \
  -H "authorization: Bearer 你设置的 API_KEY"
```

测试聊天：

```bash
curl https://feed2api.example.zeabur.app/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer 你设置的 API_KEY" \
  -d '{"model":"Claude Opus 4.8","messages":[{"role":"user","content":"你好"}]}'
```


## 6. new-api 配置

在你自己部署的 new-api 里新增一个 OpenAI 兼容渠道。

推荐填法：

- 类型：OpenAI 或 OpenAI Compatible
- Base URL：`https://你的-zeabur域名`
- API Key：填 Zeabur 里的 `API_KEY`
- 模型：从模型获取接口同步，或手动填 `Claude Opus 4.8` 等模型名

如果你的 new-api 要求 Base URL 必须带 `/v1`，就填：

```text
https://你的-zeabur域名/v1
```

模型获取接口已经支持：

```text
GET /v1/models
GET /models
```

注意：这些模型名会映射到 PromptQL 的真实模型配置，但底层仍然是同一个 PromptQL 项目和账号额度。


## 7. SillyTavern 配置

在 SillyTavern 里选 OpenAI 兼容接口：

- API 类型：OpenAI Compatible
- Base URL：`https://你的-zeabur域名/v1`
- API Key：填 Zeabur 里的 `API_KEY`
- Model：选择 `/v1/models` 返回的模型，例如 `Claude Opus 4.8`

流式输出可以开。内部仍是等 PromptQL 完整回复后一次性推给 SillyTavern。


## 8. 当前上游状态

真实调用已经验证到 PromptQL 线程创建和事件轮询都能通。

但你的 PromptQL 项目当前返回：

```text
Your project has been suspended by an administrator. Please contact support.
```

这不是代理代码问题。只要 PromptQL 继续返回 suspended，客户端侧会收到 502。
需要先在 PromptQL 侧解除项目暂停，聊天才会真正产出角色扮演回复。


## 9. 本地测试

PowerShell：

```powershell
$env:PROMPTQL_TOKEN="你的 pql_ut_ token"
$env:PROMPTQL_PROJECT_ID="8969d7e6-d5df-4046-9d23-7d0815eb7823"
$env:PROMPTQL_ROOMLESS="true"
$env:API_KEY="test-key"
npm start
```

另开终端：

```bash
curl http://localhost:3000/v1/models \
  -H "authorization: Bearer test-key"

curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer test-key" \
  -d "{\"model\":\"Claude Opus 4.8\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}"
```
