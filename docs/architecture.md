# 架构

## 1. 分层与边界

```text
src/app              React 路由 / AppShell / 顶栏 / 设置页
src/features/paper   Tiptap 编辑器、Block ID 插件、图片节点、斜杠菜单
src/features/canvas  tldraw 视图、自定义 Shape、卡片编辑浮层
src/features/scratches, search, backup, settings
src/core             纯领域：类型、Zod schema、节点/文本/Markdown 纯函数
src/storage          Dexie、Repository、DocumentService（保存队列/冲突/历史）
src/shared           UI primitives、主题、Toast、格式化、下载
```

强制边界：

- `core/` 不导入 React、Tiptap、tldraw、Dexie 或网络 SDK。
- Paper / Canvas 只通过 `DocumentService` 修改数据，不直接访问 Dexie。
- `backup/` 不直接改编辑器实例；导出前经 `DocumentService.exportDataset()` flush + 一致性读取，恢复通过 `replaceDataset()`。
- 第三方编辑器内部状态不是正文权威源。

## 2. 数据模型

```ts
Scratch        { id, title, titleIsAuto, activeMode, createdAt, updatedAt, revision, deletedAt? }
ContentBlock   { id, scratchId, kind: 'richtext'|'code'|'image', content: { node }, revision, ... }
PaperLayout    { scratchId, blockOrder: ID[] }
CanvasLayout   { scratchId, snapshot, sessionState?, hiddenBlockIds, updatedAt }
MediaAsset     { id, mimeType, size, sha256?, createdAt, blob }   // DB 内以 bytes 存储
```

`ContentBlock.content.node` 是**单个顶层 Tiptap/ProseMirror 节点**，其 `attrs.blockId` 等于 Block ID。正文只有这一份；Paper 顺序与 Canvas 位置都只引用 ID。

### 2.1 Block ID 插件

`features/paper/extensions.tsx` 的 `BlockIds`：

- 为所有顶层节点（段落、标题、引用、代码块、列表、分隔线、图片）添加 `blockId` 属性。
- `appendTransaction` 在新节点缺少 ID、或回车拆分/粘贴复制出重复 ID 时分配新 UUID。
- 这是“Paper 的顺序视图”和“Canvas 的卡片”能稳定对应的关键。

### 2.2 Paper 同步

`DocumentService.syncPaperDocument(doc, scratchId?)` 在每次 Tiptap `onUpdate` 时运行：

1. 遍历顶层节点，收集/生成 `blockId`。
2. 空段落（`isNodeMeaningful === false`）不会新建 Block；已存在的空 Block 会保留，避免用户清空内容时突然丢块。
3. 内容、kind 变化才递增 Block revision；顺序变化写回 `blockOrder`。
4. 文档中已删除的节点对应 Block 被移除（这是用户在 Paper 中的显式删除），Canvas 适配器随后删除孤儿卡片。
5. 若标题仍是自动模式，取第一个非空块的前 80 字符作为标题。

模式切换时 Paper 卸载，cleanup 会再同步一次当前文档；切换草稿前 `openScratch()` 会先 flush 保存队列并调用 Canvas flusher。

### 2.3 Canvas 同步

`CanvasView` 加载 `canvasLayouts.snapshot`（tldraw store snapshot）与相机状态，然后 `reconcile()`：

- 纸张存在但画布没有卡片的 Block → 在确定性网格中找不重叠空位创建 `block-card`。
- 卡片只保存 `{ blockId, w, h }`；正文由 `BlockCardPreview` 从 `DocumentService` 状态读取并渲染，因此 Paper 修改后卡片立即更新。
- 画布快照中引用了已删除 Block 的卡片 → 程序化删除。
- 用户删除卡片 → store 监听检测到卡片消失，`hideBlock()` 加入 `hiddenBlockIds`；内容仍在纸张中，可通过“恢复隐藏”重新出现。Undo 恢复卡片时会自动 `unhideBlock()`。
- 显式“删除内容” → `deleteBlock()`，纸张与画布同时移除。
- 画布新增卡片 → `addBlockFromCanvas()` 创建新 Block 并追加到 Paper 末尾，然后把新 shape 放在视口中心。

双击卡片由 `ShapeUtil.onDoubleClick` 派发 `scratch:edit-card` 事件，画布视图打开一个按 shape 屏幕坐标定位的 Tiptap 浮层。浮层内 Enter 使用 hard break，避免一次编辑意外产生多个 Block；关闭时若仍出现多个顶层节点（如多段粘贴），`replaceBlockWithNodes()` 会把第一个节点保留原 Block ID，其余拆成新 Block 并插入 Paper。

### 2.4 画布显示设置

画布右上角提供“画布设置”面板（`CanvasSettingsPanel`），偏好保存于
`localStorage['scratch:canvasPreferences']`，按浏览器生效：

| 设置 | 实现 |
| --- | --- |
| 吸附与对齐线 | `editor.user.updateUserPreferences({ isSnapMode })`；默认开启，按住 ⌘/Ctrl 临时关闭 |
| 网格背景 | `editor.updateInstanceState({ isGridMode })`；开启后显示点阵并吸附网格 |
| 小地图 | 注册 tldraw Minimap 组件，并驱动其 NavigationPanel 原生折叠开关 |
| 样式面板 | 条件注册 tldraw `StylePanel` 组件 |
| tldraw 菜单 | 条件注册 `TopPanel` / `MenuPanel`，暴露页面菜单与主菜单 |

打开面板时会从编辑器读取当前的 snap/grid 状态并回写偏好，避免用户通过 tldraw
原生菜单修改后出现界面与实际不一致。设置只影响当前浏览器的画布 UI，不写入草稿
或备份。

## 3. 本地存储

Dexie 数据库 `scratch-db`，v1 表：

| 表 | 主键 / 索引 | 用途 |
| --- | --- | --- |
| `scratches` | id, updatedAt, deletedAt, title | 草稿元数据 / 回收站 |
| `blocks` | id, scratchId, updatedAt | 正文块 |
| `paperLayouts` | scratchId | Block 顺序 |
| `canvasLayouts` | scratchId | tldraw snapshot、相机、隐藏列表 |
| `assets` | id, sha256 | 图片字节（`Uint8Array`） |
| `history` | ++id, scratchId, createdAt | 历史快照（JSON，含布局） |
| `safetyBackups` | id, createdAt | 恢复前完整 `.scratchbackup`（最多 5 份） |
| `backupJobs` | id, providerId, status, createdAt | 备份任务日志（最多 100 条） |
| `settings` | key | 主题、备份设置、Token 等 |

图片存字节而不是 `Blob`：部分环境/结构化克隆对 `Blob` 支持不稳定，字节是 IndexedDB 最可靠的表示；读取时再构造 `Blob` 与 object URL。

### 3.1 保存队列

`DocumentService` 维护内存 session（当前草稿的 blocks Map + order + canvas）：

- 任何变更立即更新内存并标记 dirty；DB 写使用 500ms 防抖，最迟 2s 写一次。
- 写入串行；一次事务写 scratches / blocks / paperLayouts / canvasLayouts，并在同事务递增全局 `datasetRevision`。
- 每次成功提交把草稿 revision +1。
- 页面隐藏 / `pagehide` / 模式切换 / 草稿切换 / 备份导出前都会尽力 flush。
- 不使用 `beforeunload` 作为唯一保障，也不承诺断电零丢失；保存失败在顶栏显示“保存失败，重试”。

### 3.2 冲突与多标签

- 每个 session 记录上次提交的 revision；写入时 `saveSession` 在事务内比较 DB revision，不一致抛 `ConflictError`，不覆盖。
- `BroadcastChannel('scratch-sync')` 广播提交。其他标签页若无待保存修改则自动加载；若有本地修改则显示冲突横幅：
  - **放弃本地并加载**：重新读取 DB。
  - **保留本地并覆盖**：采用远端 revision 后强制提交（显式操作）。
- 冲突状态在解决前阻止自动保存，避免静默覆盖。

### 3.3 历史与安全备份

- 每 5 分钟检查 `datasetRevision`，有变化则为当前草稿写 JSON 快照；每草稿保留 50 份。
- 恢复前总是先生成当前数据集的完整未加密 `.scratchbackup` 存入 `safetyBackups`（最多 5 份），然后才替换；安全备份失败则中止恢复。
- v1 的恢复 UI 使用远程快照、本地备份文件与安全备份；周期快照的独立浏览 UI 未实现（数据已保留）。

## 4. 备份架构

详见 [backup-format.md](backup-format.md)。要点：

- 右上角备份流程：flush → 一致性读取 → 生成 ZIP →（可选）加密 → 上传唯一命名快照 → 列表回读校验大小 → 写本地 `backup.last` 元数据 → 按保留数清理旧快照。
- 云端没有权威性，自动备份永不下载覆盖本地。
- 所有 Provider 只操作 Scratch 命名空间 `scratchbackup-*.scratchbackup`，删除前仅针对该前缀。
- Provider 凭证保存在 IndexedDB / sessionStorage；不进入备份包、不写日志。S3 长期密钥在 UI 中明确风险提示。

## 5. 安全

- Tiptap schema 白名单过滤粘贴 HTML；卡片预览用 React 元素渲染 JSON，不使用 `dangerouslySetInnerHTML`。
- 导入：先解析中央目录限制文件数/体积，再解压；Zod 校验全部记录；SHA-256 校验负载；资源 magic bytes 校验；交叉引用修复/拒绝；失败不修改本地数据。
- 备份加密：PBKDF2-SHA-256（310,000）+ AES-256-GCM，独立 salt/IV；明文头只含版本与 KDF 参数。
- PWA 只预缓存静态资源，`runtimeCaching: []`。
- 无账号系统；没有服务端。

## 6. 测试策略

| 层 | 覆盖 |
| --- | --- |
| 单元 | 节点判定、标题、Markdown、ZIP 校验、加密/错误密码、篡改检测、S3 SigV4（AWS 官方向量） |
| 集成 | DocumentService（同步/标题/删除/隐藏/回收站/替换/冲突/资源去重）、多标签广播、BackupService（上传校验、保留策略、自动备份门限、恢复前安全备份、加密） |
| E2E | Paper 写作 → Canvas 卡片 → 双击编辑 → 回到 Paper → 刷新；导出并恢复 `.scratchbackup`；搜索/回收站；斜杠菜单/Markdown/拖拽手柄；6 轮模式切换；图片插入与画布同步；画布设置持久化；带 HTML 包装的 Markdown（表格/任务/图片）解析 |
| 离线 | 生产构建 + Service Worker，断网后启动与编辑 |
