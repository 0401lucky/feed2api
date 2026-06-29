# feed2API

给 SillyTavern 用的 PromptQL 聊天代理。

它把 OpenAI 兼容的聊天请求转成 PromptQL Webhook 调用，再轮询线程事件取回助手回复。

- `GET /health`：进程健康检查
- `GET /ready`：检查 PromptQL 配置和上游连通性
- `GET /v1/models`：OpenAI 兼容模型列表
- `POST /v1/chat/completions`：OpenAI 兼容聊天接口

不支持工具调用、函数调用、多模态上传。角色扮演聊天够用。


## 1. 已确认的 PromptQL 配置

这次已经用你的登录账号真实确认过：

```bash
PROMPTQL_PROJECT_NAME=p-8969d7e6-d5df
PROMPTQL_PROJECT_ID=8969d7e6-d5df-4046-9d23-7d0815eb7823
PROMPTQL_ROOM_NAME=general
PROMPTQL_ROOM_ID=bc6ffc31-1441-4adc-bac8-e375a5671be4
PROMPTQL_WEBHOOK_BASE_URL=https://data.prompt.ql.app/promptql/playground-v2
PROMPTQL_CHAT_GRAPHQL_ENDPOINT=https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql
```

注意：长期部署不能依赖网页登录态，所以本项目使用 PromptQL Webhook。
Webhook 必须绑定房间，当前会把 SillyTavern 请求发到 `general` 房间。


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


## 3. Zeabur 部署

### 3.1 从 GitHub 部署

1. 打开 Zeabur
2. 新建 Project
3. 选择从 GitHub 导入
4. 选择仓库 `0401lucky/feed2api`
5. 部署方式选 Dockerfile

仓库已经带了 `Dockerfile`，不需要额外构建命令。


### 3.2 环境变量

最小必填：

```bash
API_KEY=给 SillyTavern 填的代理密钥
PROMPTQL_TOKEN=你的 pql_ut_ token
PROMPTQL_PROJECT_ID=8969d7e6-d5df-4046-9d23-7d0815eb7823
PROMPTQL_ROOM_ID=bc6ffc31-1441-4adc-bac8-e375a5671be4
```

建议完整填写：

```bash
PROMPTQL_PROJECT_NAME=p-8969d7e6-d5df
PROMPTQL_ROOMLESS=false
PROMPTQL_ROOM_NAME=general
PROMPTQL_WEBHOOK_BASE_URL=https://data.prompt.ql.app/promptql/playground-v2
PROMPTQL_CHAT_GRAPHQL_ENDPOINT=https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql
PROMPTQL_AUTH_HEADER=authorization
PROMPTQL_AUTH_SCHEME=pat
PROMPTQL_TIMEOUT_MS=120000
PROMPTQL_REQUEST_TIMEOUT_MS=30000
PROMPTQL_POLL_INTERVAL_MS=1200
PROMPTQL_MAX_EVENTS=200
```

`PROMPTQL_ROOMLESS` 必须是 `false`。Webhook 模式不支持 roomless。


### 3.3 端口和挂载卷

不用改端口。服务会读取 Zeabur 自动注入的 `PORT`，本地默认 `3000`。

不需要挂载卷。服务无状态，不保存聊天记录、不写数据库。


## 4. 部署后检查

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

测试聊天：

```bash
curl https://feed2api.example.zeabur.app/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer 你设置的 API_KEY" \
  -d '{"model":"promptql-roleplay","messages":[{"role":"user","content":"你好"}]}'
```


## 5. SillyTavern 配置

在 SillyTavern 里选 OpenAI 兼容接口：

- API 类型：OpenAI Compatible
- Base URL：`https://你的-zeabur域名/v1`
- API Key：填 Zeabur 里的 `API_KEY`
- Model：`promptql-roleplay`

流式输出可以开。内部仍是等 PromptQL 完整回复后一次性推给 SillyTavern。


## 6. 当前上游状态

真实调用已经验证到 PromptQL Webhook 和线程事件轮询都能通。

但你的 PromptQL 项目当前返回：

```text
Your project has been suspended by an administrator. Please contact support.
```

这不是代理代码问题。只要 PromptQL 继续返回 suspended，SillyTavern 侧会收到 502。
需要先在 PromptQL 侧解除项目暂停，聊天才会真正产出角色扮演回复。


## 7. 本地测试

PowerShell：

```powershell
$env:PROMPTQL_TOKEN="你的 pql_ut_ token"
$env:PROMPTQL_PROJECT_ID="8969d7e6-d5df-4046-9d23-7d0815eb7823"
$env:PROMPTQL_ROOM_ID="bc6ffc31-1441-4adc-bac8-e375a5671be4"
$env:API_KEY="test-key"
npm start
```

另开终端：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer test-key" \
  -d "{\"model\":\"promptql-roleplay\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}"
```
