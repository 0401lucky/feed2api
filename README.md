# feed2API

给 SillyTavern 用的 PromptQL 聊天代理。

它只做一件事：把 OpenAI 兼容的聊天请求转发到 PromptQL。

- `GET /health`：进程健康检查
- `GET /ready`：检查 PromptQL 配置和上游连通性
- `GET /v1/models`：OpenAI 兼容模型列表
- `POST /v1/chat/completions`：OpenAI 兼容聊天接口

不支持工具调用、函数调用、多模态上传。角色扮演场景够用。


## 1. PromptQL 需要准备什么

### 1.1 获取项目名

你给的地址是：

```text
https://prompt.ql.app/project/p-8969d7e6-d5df/room/general/feed
```

其中项目名就是：

```text
p-8969d7e6-d5df
```

部署时填：

```bash
PROMPTQL_PROJECT_NAME=p-8969d7e6-d5df
```


### 1.2 获取 PromptQL Token

不要复制浏览器 Cookie、localStorage 或网页登录态。

推荐在 PromptQL 控制台创建专门的 token：

1. 登录 `https://prompt.ql.app`
2. 进入你的项目
3. 找到 `Settings` / `Admin` / `Tokens` / `User Tokens` 之类的入口
4. 创建 `User Token` 或 `Bot Token`
5. 名称建议填 `feed2api-zeabur`
6. 权限如果有 scope 选择，优先选择能聊天和访问该项目的权限
7. 创建后复制 token，只会完整显示一次

部署时填：

```bash
PROMPTQL_TOKEN=刚复制的 token
```

如果界面入口变了，可以在 PromptQL 页面里用 `Ctrl + K` 或页面搜索找
`token`、`bot token`、`user token`。


### 1.3 是否需要房间

角色扮演建议使用 roomless 模式：

```bash
PROMPTQL_ROOMLESS=true
```

这样 SillyTavern 的对话不会刷到 `general/feed`。

如果你想让对话进入某个房间，再改成：

```bash
PROMPTQL_ROOMLESS=false
PROMPTQL_ROOM_NAME=general
```


### 1.4 聊天端点怎么处理

默认配置会按 PromptQL 前端规则派生聊天 GraphQL 端点：

```bash
PROMPTQL_PLAYGROUND_HOST=https://playground.promptql.pro.hasura.io
```

大多数情况下不用改。

如果部署后访问 `/ready` 提示聊天端点 SSL、404 或 schema 不存在：

1. 打开 `https://prompt.ql.app`
2. 进入项目并发送一条普通消息
3. 打开浏览器开发者工具 `Network`
4. 过滤 `graphql` 或 `start_thread`
5. 找到请求体里包含 `start_thread` 的请求
6. 复制它的 `Request URL`
7. 在 Zeabur 里填：

```bash
PROMPTQL_CHAT_GRAPHQL_ENDPOINT=复制到的 Request URL
```


## 2. Zeabur 部署

### 2.1 从 GitHub 部署

1. 打开 Zeabur
2. 新建 Project
3. 选择从 GitHub 导入
4. 选择仓库 `0401lucky/feed2api`
5. 部署方式选 Dockerfile 或自动识别 Node.js 都可以

仓库里已经带了 `Dockerfile`。


### 2.2 环境变量

最小必填：

```bash
PROMPTQL_TOKEN=你的 PromptQL token
PROMPTQL_PROJECT_NAME=p-8969d7e6-d5df
PROMPTQL_ROOMLESS=true
API_KEY=给 SillyTavern 填的代理密钥
```

建议也填：

```bash
PROMPTQL_TIMEZONE=Asia/Shanghai
PROMPTQL_TIMEOUT_MS=120000
PROMPTQL_REQUEST_TIMEOUT_MS=30000
PROMPTQL_POLL_INTERVAL_MS=1200
```

一般不要改：

```bash
PROMPTQL_CONTROL_GRAPHQL_ENDPOINT=https://data.pro.ql.app/v1/graphql
PROMPTQL_PLAYGROUND_HOST=https://playground.promptql.pro.hasura.io
```

只有排错时才填：

```bash
PROMPTQL_CHAT_GRAPHQL_ENDPOINT=
PROMPTQL_PROJECT_ID=
PROMPTQL_ROOM_ID=
PROMPTQL_BUILD_ID=
PROMPTQL_BUILD_FQDN=
```


### 2.3 端口

不用改端口。

服务会读取 Zeabur 自动注入的 `PORT`。本地默认是 `3000`。

如果 Zeabur 页面强制让你填端口，就填：

```text
3000
```


### 2.4 挂载卷

不需要挂载卷。

这个服务是无状态代理，不保存聊天记录、不落数据库、不写文件。


### 2.5 启动命令

Dockerfile 部署时不用填。

如果 Zeabur 走 Node.js 自动识别，启动命令填：

```bash
npm start
```


## 3. 部署后检查

假设 Zeabur 域名是：

```text
https://feed2api.example.zeabur.app
```

先检查进程：

```bash
curl https://feed2api.example.zeabur.app/health
```

再检查 PromptQL 配置：

```bash
curl https://feed2api.example.zeabur.app/ready \
  -H "authorization: Bearer 你设置的 API_KEY"
```

如果 `/health` 正常但 `/ready` 不正常，通常是：

- `PROMPTQL_TOKEN` 不对或权限不够
- `PROMPTQL_PROJECT_NAME` 填错
- 聊天 GraphQL 端点需要手动填 `PROMPTQL_CHAT_GRAPHQL_ENDPOINT`


## 4. SillyTavern 配置

在 SillyTavern 里选 OpenAI 兼容接口：

- API 类型：OpenAI Compatible
- Base URL：`https://你的-zeabur域名/v1`
- API Key：填 Zeabur 里的 `API_KEY`
- Model：`promptql-roleplay`

流式输出可以开。  
但内部仍是等 PromptQL 完整回复后一次性推给 SillyTavern。


## 5. 本地测试

PowerShell 示例：

```powershell
$env:PROMPTQL_TOKEN="你的 PromptQL token"
$env:PROMPTQL_PROJECT_NAME="p-8969d7e6-d5df"
$env:PROMPTQL_ROOMLESS="true"
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


## 6. 常见问题

### 6.1 返回 API Key 不正确

SillyTavern 里的 API Key 要和 Zeabur 环境变量 `API_KEY` 一致。


### 6.2 返回缺少 PROMPTQL_TOKEN

Zeabur 没填 `PROMPTQL_TOKEN`，或者部署后没有重新启动服务。


### 6.3 `/ready` 提示 access-denied

Token 无效、过期，或者没有访问该项目的权限。


### 6.4 `/ready` 提示找不到项目

检查 URL 里的项目名是否填对。

例如：

```text
/project/p-8969d7e6-d5df/room/general/feed
```

应该填：

```bash
PROMPTQL_PROJECT_NAME=p-8969d7e6-d5df
```


### 6.5 `/ready` 提示聊天端点不可用

按上面的 `1.4`，从浏览器 DevTools 复制 `start_thread` 的 Request URL，
填到 `PROMPTQL_CHAT_GRAPHQL_ENDPOINT`。
