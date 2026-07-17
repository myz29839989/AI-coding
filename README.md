Task Board Lite

轻量级任务看板 MVP。当前版本采用 JSON 文件存储，不依赖 SQLite 或外部数据库。

功能





主控面板：创建团队、进入团队、删除团队。



团队看板：团队切换、返回主控、创建任务、拖拽更新状态。



后端保障 teamId 数据隔离。



状态更新使用 version 乐观锁，旧版本更新返回 409。



删除团队时级联删除该团队任务。

启动

启动后端：

cd D:\桌面\AIcoding\task-board-lite\backend

npm.cmd start


打开前端：

cd D:\桌面\AIcoding\task-board-lite\frontend

.\index.html

前端是静态页面，可直接用浏览器打开。

数据文件

默认数据存储在：

backend/data/db.json

JSON 存储仅用于本地 MVP。若后续需要多用户高并发或生产部署，应迁移到 SQLite、PostgreSQL 或其他数据库。
