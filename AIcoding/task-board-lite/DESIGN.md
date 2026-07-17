# Task Board Lite 系统设计方案

## 1. 设计目标

当前系统采用最小可用实现，目标是用最少依赖完成任务看板核心链路：

- 主控面板管理团队。
- 团队看板管理任务。
- 后端保证团队数据隔离。
- JSON 文件保存数据。
- 任务拖拽更新状态。
- 使用 `version` 处理简化并发冲突。

设计原则：

- 优先可运行。
- 优先清晰。
- 避免过度工程化。
- 将关键一致性逻辑放在后端。

## 2. 技术选型

| 层级 | 技术 | 选择理由 |
| --- | --- | --- |
| 前端 | HTML + CSS + 原生 JavaScript | 零构建、零依赖，可直接打开运行 |
| 后端 | Node.js 原生 HTTP | 避免 Express 安装依赖，降低环境成本 |
| 数据存储 | JSON 文件 | SQLite 当前不可用，MVP 使用文件存储降级 |
| 测试 | Node.js 内置 test runner | 无需安装 Jest/Vitest |
| 拖拽 | HTML5 Drag and Drop | 满足桌面端 MVP 拖拽需求 |

## 3. 系统架构

```text
+-----------------------------+
| Browser                     |
| frontend/index.html         |
| frontend/src/app.js         |
+--------------+--------------+
               |
               | HTTP JSON
               v
+--------------+--------------+
| Node.js API Server          |
| backend/src/server.js       |
| - routing                   |
| - validation                |
| - team isolation            |
| - version check             |
+--------------+--------------+
               |
               | read/write
               v
+--------------+--------------+
| JSON Storage                |
| backend/data/db.json        |
+-----------------------------+
```

## 4. 页面设计

### 4.1 主控面板

职责：

- 创建团队。
- 展示团队列表。
- 进入团队。
- 删除团队。

页面结构：

```text
Task Board Lite
主控面板

[新团队名称] [创建]

团队列表
- 团队 A    [进入] [删除]
- 团队 B    [进入] [删除]
```

### 4.2 团队任务看板

职责：

- 当前团队上下文展示。
- 切换团队。
- 返回主控。
- 创建任务。
- 三列任务状态展示。
- 拖拽任务更新状态。

页面结构：

```text
[返回主控] 当前团队：团队 A

团队切换：[团队 A v]
[任务标题] [描述] [新增任务]

+-------------+----------------+-------------+
| 待办 (2)    | 进行中 (1)     | 已完成 (0)  |
| Task A      | Task C         |             |
| Task B      |                |             |
+-------------+----------------+-------------+
```

## 5. 核心数据模型

### 5.1 Team

```json
{
  "id": "team_xxx",
  "name": "前端团队",
  "createdAt": "2026-07-17T00:00:00.000Z",
  "updatedAt": "2026-07-17T00:00:00.000Z"
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| id | 团队唯一 ID |
| name | 团队名称 |
| createdAt | 创建时间 |
| updatedAt | 更新时间 |

### 5.2 Task

```json
{
  "id": "task_xxx",
  "teamId": "team_xxx",
  "title": "实现拖拽",
  "description": "任务描述",
  "status": "todo",
  "version": 1,
  "createdAt": "2026-07-17T00:00:00.000Z",
  "updatedAt": "2026-07-17T00:00:00.000Z"
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| id | 任务唯一 ID |
| teamId | 所属团队 ID，也是团队隔离关键字段 |
| title | 任务标题 |
| description | 任务描述 |
| status | 任务状态：`todo`、`doing`、`done` |
| version | 乐观锁版本 |
| createdAt | 创建时间 |
| updatedAt | 更新时间 |

## 6. 数据文件结构

```json
{
  "teams": [],
  "tasks": []
}
```

文件路径：

```text
backend/data/db.json
```

写入策略：

1. 读入完整 JSON。
2. 在内存中修改数据。
3. 写入临时文件 `db.tmp.json`。
4. 使用 `rename` 替换正式文件。

这样可以降低写入过程中断导致 JSON 文件损坏的风险。

## 7. 接口设计

### 7.1 健康检查

```http
GET /api/health
```

响应：

```json
{
  "ok": true
}
```

### 7.2 查询团队列表

```http
GET /api/teams
```

响应：

```json
{
  "teams": []
}
```

### 7.3 创建团队

```http
POST /api/teams
```

请求：

```json
{
  "name": "前端团队"
}
```

响应：

```json
{
  "team": {
    "id": "team_xxx",
    "name": "前端团队"
  }
}
```

### 7.4 删除团队

```http
DELETE /api/teams/:teamId
```

行为：

- 删除团队。
- 删除该团队下所有任务。

### 7.5 查询团队看板

```http
GET /api/teams/:teamId/board
```

响应：

```json
{
  "team": {
    "id": "team_xxx",
    "name": "前端团队"
  },
  "statuses": ["todo", "doing", "done"],
  "tasks": [],
  "board": {
    "todo": [],
    "doing": [],
    "done": []
  }
}
```

### 7.6 创建任务

```http
POST /api/teams/:teamId/tasks
```

请求：

```json
{
  "title": "实现看板拖拽",
  "description": "支持任务从待办移动到进行中"
}
```

响应：

```json
{
  "task": {
    "id": "task_xxx",
    "teamId": "team_xxx",
    "title": "实现看板拖拽",
    "status": "todo",
    "version": 1
  }
}
```

### 7.7 更新任务状态

```http
PATCH /api/teams/:teamId/tasks/:taskId/status
```

请求：

```json
{
  "status": "doing",
  "version": 1
}
```

成功响应：

```json
{
  "task": {
    "id": "task_xxx",
    "status": "doing",
    "version": 2
  }
}
```

冲突响应：

```http
409 Conflict
```

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "task version conflict",
    "current": {
      "id": "task_xxx",
      "status": "doing",
      "version": 2
    }
  }
}
```

## 8. 团队隔离方案

团队隔离是本系统最重要的后端约束。

隔离规则：

1. 所有任务必须包含 `teamId`。
2. 查询团队看板时，只返回 `task.teamId === teamId` 的任务。
3. 创建任务时，任务绑定当前 URL 中的 `teamId`。
4. 更新任务状态时，必须同时匹配 `teamId` 和 `taskId`。
5. 删除团队时，删除所有 `task.teamId === teamId` 的任务。

错误示例：

```js
tasks.find((task) => task.id === taskId)
```

正确示例：

```js
tasks.find((task) => task.id === taskId && task.teamId === teamId)
```

这样可以避免用户使用其他团队的 `teamId` 修改不属于该团队的任务。

## 9. 并发处理方案

### 9.1 问题

如果两个用户同时拖拽同一任务，可能出现最后写入覆盖前一次写入的问题。

### 9.2 当前方案

当前 MVP 采用两层保护：

1. 单进程写入队列。
2. `version` 乐观锁。

状态更新流程：

```text
前端读取任务 version = 1
前端拖拽任务到 doing
前端提交 taskId + teamId + status + version
后端查找 teamId + taskId
后端比较当前 version
版本一致：更新状态，version + 1
版本不一致：返回 409
```

### 9.3 局限

该方案只适合单 Node 进程。如果未来部署多个进程或多个实例，写入队列不再全局有效，应迁移到数据库事务、行级锁或集中式锁。

## 10. 前端交互流程

### 10.1 创建团队

```text
输入团队名称
点击创建
POST /api/teams
刷新团队列表
进入新团队看板
```

### 10.2 创建任务

```text
输入任务标题
点击新增任务
POST /api/teams/:teamId/tasks
刷新当前团队看板
```

### 10.3 拖拽任务

```text
dragstart 记录 taskId
drop 到目标列
读取任务当前 version
PATCH /api/teams/:teamId/tasks/:taskId/status
成功后刷新看板
409 后提示冲突并刷新看板
```

## 11. 自动化测试设计

测试脚本位置：

```text
test/task-isolation-version.test.js
```

覆盖内容：

- 创建两个团队。
- 在团队 A 创建任务。
- 查询团队 B 看板，确认看不到团队 A 任务。
- 使用团队 B 的 `teamId` 更新团队 A 的任务，返回 404。
- 使用正确版本更新任务状态，成功并递增版本。
- 使用旧版本再次更新，返回 409。
- 删除团队 A 后，团队 A 看板不可访问。
- 团队 B 不受影响。

运行方式：

```bash
cd backend
npm test
```

## 12. 来自 AI 的设计与人工干预

### 12.1 来自 AI 的建议

- 使用前后端分离架构。
- 将团队、任务、状态建模为核心实体。
- 使用接口承载团队创建、任务创建、状态更新和看板查询。
- 为拖拽状态更新增加并发保护。
- 测试覆盖团队隔离和状态更新。

### 12.2 人工干预

- 因 SQLite 不可用，将数据存储降级为 JSON 文件。
- 为了最短时间可运行，将后端改为 Node 原生 HTTP，避免安装 Express。
- 为了避免前端构建依赖，将 React/Vite 降级为静态 HTML/JS。
- 明确 `teamId + taskId` 是状态更新的必要查询条件。
- 明确旧版本更新必须返回 409，不能静默覆盖。
- 将测试脚本统一归档到根目录 `test/`。

## 13. 可行性分析

### 13.1 可行

当前方案适合远程作业 MVP：

- 依赖少。
- 启动简单。
- 功能范围明确。
- 核心风险有测试覆盖。
- 代码量可控，便于评审。

### 13.2 风险

| 风险 | 影响 | 当前处理 |
| --- | --- | --- |
| JSON 文件并发写入 | 可能覆盖数据 | 单进程写入队列 |
| JSON 文件写坏 | 应用无法读取 | 临时文件替换 |
| 多进程部署 | 队列失效 | 文档标注非生产方案 |
| 拖拽冲突 | 状态被覆盖 | `version` 乐观锁 |
| 团队串数据 | 业务严重错误 | 后端强制 `teamId` 过滤 |

### 13.3 后续演进

如果系统继续发展，建议按以下顺序升级：

1. JSON 迁移到 SQLite 或 PostgreSQL。
2. 增加登录和团队成员权限。
3. 增加列内排序。
4. 增加 WebSocket 实时协作。
5. 增加操作日志和任务历史。
