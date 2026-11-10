# Scratch — 产品需求与 Coding Agent 实施规范

> Duskbit Studio · `DuskbitStudio/Scratch` · 版本：实施规范 v1.0 · 2026-11-10  
> 状态：可执行开发任务。本文是项目的单一实施基线；如与依赖最新官方文档冲突，以实际可验证的官方接口为准并在交付报告说明。

## 0. 给 Coding Agent 的执行指令（必读）

你将独立完成 Scratch 的初始化、开发、测试、构建与交付。**不要仅输出计划或 UI 静态稿**；应在可用工作区实际编写、运行和测试代码。用户已确定产品范围和技术方向，除必须由用户亲自完成的 OAuth App 注册、云资源授权、许可证采购/申请、域名部署、密钥提供及 GitHub 写权限之外，尽可能自行完成。未获得明确授权前，不得创建远端仓库、推送、删除旧仓库、归档旧项目或执行真实生产部署。

- 以本规范为准；优先交付可运行、可持久化、可恢复的数据闭环，随后完善视觉。
- 不需要向用户重新询问已经确定的方向。遇到非阻塞性技术分歧，采用稳定、维护成本更低的实现，并记录 ADR（Architecture Decision Record）。
- 先检查项目是否已有代码，再进行最小必要改造；若空仓库，初始化项目。
- 不得在 `localStorage` 或源码中写入云服务商长期 Secret、OAuth Client Secret；不提交任何真实 Key。
- 不得假装 OAuth、备份、许可证、测试或部署已经成功。外部配置缺失时提供可运行的 Mock/本地测试与明确的配置步骤。
- **以数据安全为最高优先级**：任何更新、恢复或数据库迁移均不得静默丢弃本地数据。
- 每个阶段完成后运行相应测试，最终提交 README、配置示例、测试结果、已知限制和下一步待用户操作事项。

## 1. 产品定位和目标

Scratch 是 Duskbit 旗下的个人网页草稿空间。核心体验：**打开就写，想整理就拖，关掉内容仍在。**

用户既可能随手记录文字、代码、链接、图片，也可能把零散想法拆成卡片，在无限画布上自由摆放、分组和连线。界面现代、简约、冷静、轻盈，不做第二个 Notion/Obsidian/Miro。

### 1.1 必须实现

1. **Paper（纸张）模式**：所见即所得富文本，兼容常见 Markdown 快捷输入、标题/列表/引用/代码块/链接/图片粘贴，顺序书写。
2. **Canvas（画布）模式**：无限画布、平移/缩放、文本/代码/图片卡片、拖动和调整大小、连线、分组。双击卡片可编辑内容。
3. **两模式共享数据**：同一 Block 唯一内容源；Paper 管顺序，Canvas 管空间位置、连线、分组；来回切换不丢内容或布局。
4. **多草稿管理**：新建、重命名、删除（可撤销或回收站）、切换、列表与全文搜索。
5. **Local-first**：IndexedDB 本地存储，自动保存、历史快照、刷新恢复、数据结构升级；离线可用。
6. **导入/导出**：完整 Scratch 备份包和恢复，纯文本/Markdown 导出。至少有完整备份包可带走图片与画布数据。
7. **BYOS Cloud Backup**：用户自己的云存储；OneDrive 首发可用；Google Drive 后续适配；WebDAV / S3 兼容接口设计和可测适配，遵守 CORS/凭证限制。手动备份、浏览器打开期间定时备份、备份历史和显式恢复。
8. **现代简约的响应式 UI**：浅色/深色/跟随系统，桌面优先，同时具备手机浏览与基础编辑能力；尊重减少动画设置。

### 1.2 明确不做

- 不做 AI 聊天、AI 改写或在线生成。
- 不做账号系统、Duskbit 托管数据库、团队协作、实时多端同步、冲突合并。
- 不做文件夹树、知识图谱、插件系统、复杂模板市场或任务管理系统。
- 不让 Scratch 依赖必须在线的后端才可编辑。
- 云备份**不是**自动双向同步；其他设备的数据必须经过明确“恢复/导入”操作。

### 1.3 归属与发布

- 品牌：Duskbit Studio；仓库规划 `https://github.com/DuskbitStudio/Scratch`（尚未确认创建）。
- 独立单仓，不进入其他项目 Monorepo。
- 域名：优先沿用 `editor.nerakolo.cc`，以后可迁移 `scratch.duskbit.dev`。域名不同属于不同 origin，本地 IndexedDB 不会自动迁移；必须通过显式备份/导入迁移。
- 旧 Markdown Editor 项目应独立保留并由所有者明确授权后归档；本任务**禁止自动归档旧仓库**。

## 2. 技术栈

| 层级 | 建议选型 | 备注 |
|---|---|---|
| UI 框架 | React + TypeScript + Vite | SPA、静态部署 |
| 样式 | Tailwind CSS + CSS 变量 | 设计 Token，避免硬编码各处颜色 |
| 通用组件 | Radix Primitives 或 shadcn/ui 按需引入 | 适量，避免引入整套臃肿 UI |
| 内容编辑 | Tiptap | 扩展按需启用，内容以 Tiptap JSON 为基础 |
| 画布 | tldraw SDK（满足许可条件时） | Custom Shape，编辑层与存储层解耦 |
| 应用状态 | Zustand | 仅放会话/交互状态，不复制整个 DB |
| DB | Dexie + IndexedDB | 主数据唯一持久源 |
| 压缩 | JSZip / fflate 等 | 按性能和维护情况选择 |
| 加密 | Web Crypto API | AES-GCM，密钥从密码派生，参数记录在包中 |
| PWA | Vite PWA 插件 | 缓存应用静态资产；绝不擅自缓存含凭证 API 响应 |
| 测试 | Vitest + React Testing Library + Playwright | 重点测内容一致性与数据恢复 |
| CI | GitHub Actions | typecheck / lint / test / build |

**许可约束**：tldraw SDK 官方许可不是“随便生产部署”。开发可以使用 SDK；生产须取得有效 trial / hobby / commercial license。Hobby 许可有水印及非商用限制，Duskbit 品牌归属不能自动证明符合 hobby 条款。Agent 必须核实当前许可证要求。若无许可，则完成 Canvas Adapter / 可测试技术原型与其余模块，但**不得把不合规 tldraw 版本当作可发布生产方案**；在交付报告标注阻塞和可替代技术选项。不可绕过许可证、水印或校验。

## 3. 整体架构

```text
React App Shell
  ├── Scratch list / Search / Settings / Mode Switch
  ├── Paper Editor (Tiptap) ─── paper-adapter ───┐
  └── Canvas Editor (tldraw) ── canvas-adapter ───┤
                                                  ▼
                                    Document Core / Command API
                                       ├── Block Store
                                       ├── Paper order
                                       ├── Canvas shape refs
                                       └── Revision / validation
                                                  │
                                                  ▼
                                     Repository / Save Queue
                                       ├── Dexie IndexedDB
                                       ├── Asset blobs
                                       └── History snapshots
                                                  │
                                                  ▼
                                     Backup Service / Archive
                                       ├── Local export/import
                                       └── Storage Providers
                                          ├── OneDrive
                                          ├── Google Drive
                                          ├── WebDAV
                                          └── S3 Compatible
```

**强制边界**：
- `core/` 不依赖 React、Tiptap、tldraw、Dexie、网络 SDK；定义稳定的领域对象与命令。
- `features/paper` 和 `features/canvas` 负责 adapter，不直接互相操作。
- `storage/` 负责具体数据读写，UI 不直接查询或修改 Dexie 表。
- `backup/` 不直接修改编辑器实例，通过 repository 读取一致性快照并通过恢复流程写入。
- 每个第三方引擎的内部状态不应成为第二份权威正文。

## 4. 数据模型和双模式映射

以“草稿包含可排序 Block；画布 Shape 引用 Block”为基础；类型示例（可合理细化）：

```ts
type ID = string;
type UnixMs = number;

type Scratch = {
  id: ID;
  title: string;
  activeMode: 'paper' | 'canvas';
  createdAt: UnixMs;
  updatedAt: UnixMs;
  revision: number;
  deletedAt?: UnixMs;
};

type ContentBlock = {
  id: ID;
  scratchId: ID;
  kind: 'richtext' | 'code' | 'image';
  content: unknown; // schema validated (Tiptap JSON / code payload / asset reference)
  createdAt: UnixMs;
  updatedAt: UnixMs;
  revision: number;
};

type PaperLayout = {
  scratchId: ID;
  blockOrder: ID[]; // referenced blocks, unique
};

type CanvasLayout = {
  scratchId: ID;
  documentSnapshot: unknown; // tldraw document (pages/shapes/bindings)
  sessionState?: unknown;    // viewport, selection etc. local-only; optional in backups
};

type MediaAsset = {
  id: ID;
  mimeType: string;
  size: number;
  sha256?: string;
  blob: Blob;
};
```

### 4.1 规则

1. Block 内容唯一权威源在 `ContentBlock.content`。Canvas 自定义卡片 Shape 的 props 只保存 `blockId`、宽高、可视化属性，不保存独立正文副本。
2. Paper 是按 `blockOrder` 排列的 Block 序列，不是另存一份 Markdown 字符串；Markdown 仅负责快捷输入与导出。
3. 不采用“一个段落一张卡片”硬映射：一个 richtext Block 可含多个段落。一张卡片对应一个 Block。
4. 初次进入 Canvas 时，为尚未出现的 Block 创建默认卡片，采用确定性的网格布局；后续切换不重置位置。多卡片布局避免重叠。
5. Canvas 中新建正文卡片时，新增 Block 并将其追加到 Paper 的 `blockOrder`；Paper 中可重新排序。纯装饰图形（箭头、形状）可以仅存在于 Canvas。
6. 删除需要区分“从画布隐藏卡片”和“彻底删除内容”；默认不得因删除一个 Shape 静默删掉唯一 Block。提供清晰的显式删除内容动作。
7. 重复引用同一 Block（如果支持）必须区分 Shape ID 和 Block ID；v1 可以限制同一草稿每个 Block 在画布仅存在一个内容卡片，减少歧义。
8. Paper 的整篇流式编辑与 Block 边界需做原型验证：建议每个 Block 使用独立 Tiptap 实例或定义可靠的顶层 Block ID 映射。不得每次敲 Enter 都意外生成/重排 Block。
9. Canvas 默认只读渲染卡片内容，双击再初始化 Tiptap 编辑器；不得常驻成百上千个编辑实例。
10. 编辑中的数据先进入 Core 内存 revision，再异步落盘；模式切换需 flush 当前编辑状态，不丢失 composition/IME 输入。
11. Tiptap `setContent` 的事件行为随版本变化，外部数据更新时需使用防回环策略。不得循环触发 `onUpdate → setContent → onUpdate`。
12. Undo/Redo：文本编辑由 Tiptap 负责，画布布局由画布引擎负责；v1 不要求两引擎跨模式统一 Undo 栈。

### 4.2 核心操作接口（建议）

```ts
interface ScratchDocumentService {
  createScratch(title?: string): Promise<Scratch>;
  renameScratch(id: ID, title: string): Promise<void>;
  listScratches(): Promise<Scratch[]>;
  trashScratch(id: ID): Promise<void>;
  restoreTrashedScratch(id: ID): Promise<void>;
  addBlock(scratchId: ID, block: NewBlock, position?: number): Promise<ID>;
  updateBlock(blockId: ID, nextContent: unknown, expectedRevision?: number): Promise<void>;
  reorderBlocks(scratchId: ID, order: ID[]): Promise<void>;
  saveCanvasLayout(scratchId: ID, layout: CanvasLayout): Promise<void>;
  flushPendingWrites(): Promise<void>;
  createConsistentSnapshot(): Promise<ScratchArchiveData>;
}
```

实现时用 Zod 等运行时 schema 校验数据合法性。不要信任导入包 JSON 或远端文件的类型。

## 5. 交互与 UI 设计规范（重点）

### 5.1 整体视觉定位

**Modern Minimal / Editorial / Calm Productivity**。参考现代笔记工具的清爽排版，但不要照搬 Notion、Linear、Apple Notes 的页面或品牌资产。视觉上追求：干净、克制、低噪音、细节精确。

- 以中性色为主：暖白或微冷灰背景，深灰正文，只有少量蓝/靛色强调色。
- 轻边框优先，极少阴影；不要渐变大背景、玻璃拟态堆叠、霓虹、赛博风、沉重侧栏。
- 使用 8px spacing scale；圆角 8–12px；极少使用 16px 以上的大圆角。
- 字体系统栈优先：`Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Noto Sans SC`, sans-serif；等宽用 `JetBrains Mono`/系统等宽。可使用公共 CDN 但不得影响离线能力，优先系统回退。
- 桌面编辑区最大宽度约 760–860px；行高 1.65 左右，正文约 15–16px；标题用较舒适的字重和字距。
- 工具栏默认低存在感，选中或 hover 才呈现相关操作；图标线性且大小统一。
- 动画 120–220ms，主要用于侧栏、标签切换和弹出菜单；支持 `prefers-reduced-motion`。
- 提供浅色 / 深色 / 跟随系统；深色不是纯黑背景。
- 设计必须有清晰的 hover、focus-visible、disabled、loading、error 状态；键盘可用，色彩对比度达到 WCAG AA 的实用水平。
- 不能通过装饰文字或无交互假按钮冒充功能。

### 5.2 主界面

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ [Scratch]  草稿搜索                 [Paper | Canvas]       备份状态   ⚙ │
├─────────────┬─────────────────────────────────────────────────────────────┤
│ + 新草稿     │                                                             │
│             │  Paper: 适宽居中、无边框感的写作区域                        │
│ 最近草稿     │  Canvas: 填满可用空间的自由画布                            │
│ 草稿 A       │                                                             │
│ 草稿 B       │                                                             │
│ 草稿 C       │                                                             │
│             │                                                             │
│ 回收站       │                                                             │
└─────────────┴─────────────────────────────────────────────────────────────┘
```

- 默认打开上次草稿和上次模式；首次访问直接创建一个空草稿并聚焦编辑区。
- 侧栏可收起，初始宽度 228–256px；小屏幕采用抽屉式，优先保证编辑区域。
- Paper/Canvas 切换为明显但简洁的 segmented control；不必进入设置菜单。
- 顶部展示简洁保存状态：`已保存`、`保存中`、`保存失败`，失败不可静默。
- 草稿的标题可直接编辑；未命名时自动取首行非空文本作为候选标题，但用户手动命名后不再覆盖。
- 命令：`Cmd/Ctrl+K` 草稿搜索；`Cmd/Ctrl+N` 新建草稿；`/` 打开块插入菜单（不抢占代码块输入）；合理实现快捷键提示。

### 5.3 Paper

- 富文本编辑，支持标题 H1–H3、列表（无序/有序/待办可选）、引用、分隔线、粗体、斜体、链接、行内代码、代码块。
- 支持粘贴纯文本、Markdown，以及浏览器剪贴板图片；图片作为 Blob 存 IndexedDB，正文仅存 Asset ID。
- 代码块支持语言选择、语法高亮、复制；避免引入超重编译器。
- 支持块级重排（可用轻量 drag handle），不要求复杂的多栏排版。
- 空状态展示安静的 placeholder，不展示说明书式 onboarding。
- 导出 Markdown 尽量保留文本格式与图片引用；对于画布空间关系明确提示 Markdown 不包含布局，完整备份请使用 `.scratchbackup`。

### 5.4 Canvas

- 无限画布、鼠标滚轮/触控板平移缩放、拖动卡片、框选、快捷缩放到内容。
- 视觉以淡网格/微弱点阵为底；控制工具栏尽量收敛，浮动显示。
- 卡片白色或略带灰度/柔和语义色，边框清晰，绝不把所有卡片做成厚重看板。
- 支持连接线（锚点可自动），箭头、分组、多个选中对象操作。
- Canvas 里的富文本卡片应有清晰的查看状态与编辑状态，避免拖拽和文本选中冲突。
- 处理从 Paper 新增块的默认布局，保留每个用户调整过的位置。
- 画布可包含仅在 Canvas 展示的纯几何/装饰图形；它们不需要在 Paper 转成文字段落。

### 5.5 备份设置页

- 备份状态概览：未连接/已连接/备份中/失败、上次成功时间、最近备份大小。
- 主动作：`立即备份`、`查看历史`、`从备份恢复`。
- 服务商卡片：OneDrive（优先），Google Drive、WebDAV、S3 Compatible（按实际可用状态显式显示）。
- 自动备份：默认“每 30 分钟检查是否有变化，仅网页打开时运行”；无变化不上传。
- 保留成功快照最近 10 份（可配置）；失败的上传不计入成功数，不删除最后一个有效备份。
- 恢复操作展示快照时间/草稿数量/大小，提示会影响当前本地数据；恢复前自动生成当前数据的本地安全备份，提供取消与清晰的确认流程。

## 6. 本地持久化

推荐 Dexie 数据表：

```text
scratches       id, title, createdAt, updatedAt, revision, deletedAt
blocks          id, scratchId, kind, revision, updatedAt
paperLayouts    scratchId, blockOrder
canvasLayouts   scratchId, documentSnapshot, sessionState
assets          id, mimeType, sha256, size, blob
history         id, scratchId, createdAt, snapshotRef/serializedSnapshot
settings        key, value
backupJobs      id, providerId, status, createdAt, finishedAt, archiveId
```

- 每次变动立即进入 Core 内存；数据库写入使用约 500ms debounce，另设最长延迟和写入队列串行化；草稿切换/页面隐藏时尽力 flush。
- 不许用 `beforeunload` 作为唯一保存保障；不能声称断电、崩溃时绝对零数据丢失。提供显式错误状态。
- 使用 Dexie 事务维护跨表引用完整性；迁移版本需有可重复测试，失败时回滚或保留旧数据。
- 每 5 分钟在有变化时创建历史快照；有总量和数量上限，必要时允许用户手动清理。
- 使用 `navigator.storage.persist()`（用户交互下触发）申请持久化存储；拒绝时仍保持正常使用，并提示可使用云备份。
- 跨标签页编辑可能发生写入竞争：v1 至少实现 `BroadcastChannel` 通知/刷新与单写入者或乐观 revision 校验机制；不能静默以旧数据覆盖新数据。
- 大图片可在本地压缩缩略图用于 Canvas 预览；保留原始资源或明确提醒用户压缩设置。

## 7. 备份包协议

文件后缀：`.scratchbackup`（ZIP 容器或明确版本的加密封装）；全量快照必须独立可恢复，不依赖已丢失的先前增量包。

建议 ZIP 格式：

```text
scratchbackup-20261110T120000Z.scratchbackup
├── manifest.json
├── scratches.json
├── blocks.json
├── paper-layouts.json
├── canvas-layouts.json
└── assets/
    ├── <asset-id>.png
    └── <asset-id>.webp
```

`manifest.json` 至少包含：

```json
{
  "format": "duskbit.scratch.backup",
  "formatVersion": 1,
  "createdAt": "2026-11-10T12:00:00.000Z",
  "appVersion": "1.0.0",
  "datasetId": "uuid",
  "scratchCount": 0,
  "assetCount": 0,
  "payloadSha256": "..."
}
```

- 实际 hash 规范需要明确“hash 哪些字节”，避免循环引用：推荐 manifest 外部 checksum，或按每个数据成员记录 sha256 后生成 manifest；校验所有文件完整性和大小限制。
- 导入时验证 MIME、magic bytes、尺寸限制、Schema、压缩炸弹风险；在后台/worker（按需）解析大文件，失败不得覆盖原有数据。
- 恢复提供两种模式：`合并导入（ID 冲突策略）` 与 `整体替换（危险操作，需要确认）`。首版至少实现完整替换前安全备份以及可复核的恢复路径。
- 包格式须 versioned，具有迁移入口；版本不兼容时清楚报错，不强行解析。
- 不允许在包中包含 OAuth token、S3 Secret、WebDAV 密码等凭证。

### 7.1 可选云备份加密

- 默认提供明显的“加密备份”开关（可建议默认开启，但首次配置必须由用户设定/确认密码）。
- 在浏览器客户端用 Web Crypto API；AES-256-GCM，每个快照独立随机 salt 和 IV；密钥来自用户密码，推荐 PBKDF2-SHA-256（足够强的迭代参数，记录在头部），或者经过审核的 Argon2id WASM 实现。不得使用自创密码学。
- 加密包格式需有未加密 header 记录版本/KDF 参数/salt/IV，但不得泄露草稿正文或图片。
- 密码仅用于本次加/解密，不上传、不写进备份包，也不把原始密码写入持久浏览器存储；忘记密码不能恢复，UI 必须提示。
- 对错误密码、篡改包、异常格式有清晰可区分但不泄露敏感内容的错误处理。

## 8. BYOS Cloud Backup

### 8.1 设计规则

- Backup Service 只操作不可变 Archive Blob；Provider 只负责认证、上传、列出、下载、删除、校验状态。
- **云端不具有主数据权威性**；自动备份永远不反向覆盖本地内容。
- 不支持关闭网页之后继续定时备份；不能暗示存在后台云任务。浏览器打开时基于用户设定周期和数据 revision 检查。
- 先上传新的唯一 ID 快照；确认存在/大小或 checksum 验证后，才写入 `latest` 指针/元数据；更新失败时仍可从历史列表恢复。
- 远端清理旧快照必须只针对 Scratch 自己的备份命名空间，严格检查前缀及 ID，保留最后一个有效快照。
- 接口提供进度（若 API 支持）、可取消、失败可重试、429/5xx 指数退避、Token 过期重新授权提示。
- 恢复时先下载到临时区域、校验/解密/解析、显示预览，再经事务或安全回滚流程写本地 DB。

```ts
interface BackupProvider {
  readonly id: 'onedrive' | 'google-drive' | 'webdav' | 's3';
  connect(config?: unknown): Promise<void>;
  disconnect(): Promise<void>;
  listBackups(): Promise<RemoteBackupInfo[]>;
  uploadBackup(id: string, data: Blob): Promise<RemoteBackupInfo>;
  downloadBackup(id: string): Promise<Blob>;
  deleteBackup(id: string): Promise<void>;
}
```

注意：真实 adapter 可使用 API 特定的上传会话、分页和文件 ID，不必强行把云服务都当作“可通过路径寻址的普通文件系统”。

### 8.2 OneDrive — 首发必须对接

- Microsoft identity platform OAuth 2.0 Authorization Code + PKCE，SPA 公共客户端，**不允许 Client Secret**。
- 优先使用 Microsoft Graph `/me/drive/special/approot` 及最小权限 `Files.ReadWrite.AppFolder`；微软文档提示委派权限仍为 Preview，需验证目标微软个人账号及实际租户支持情况。失败时明确告知，不偷偷改请求大范围文件权限。
- 只在 Scratch 对应 App Folder 管理文件，支持 listing、上传（小文件/大文件上传会话）、下载、删除。
- OAuth redirect URI 通过环境变量配置，和实际部署 origin 一致；开发环境使用 localhost 注册的回调地址。
- 未取得 OAuth App 注册信息时，完整实现可注入配置与 Mock 认证 + 适配器测试；在 README 给出微软 Entra 注册步骤，不伪造成功连接。

### 8.3 Google Drive — 第二优先级

- Google OAuth 公共浏览器客户端；优先 `https://www.googleapis.com/auth/drive.appdata`，使用 `appDataFolder`。注意该目录对用户的普通 Drive UI 不可见，且用户移除应用或清理数据会影响其内容。
- 依据 Google 官方 OAuth 浏览器应用要求实现 token 生命周期；不嵌入 Client Secret。
- 若未完成真实凭证配置，提供 adapter 测试及明显的待配置状态。

### 8.4 WebDAV — 第三优先级

- 适配 Nextcloud、NAS 或一般 WebDAV 服务：列目录、PUT、GET、DELETE，按所需实现 MKCOL；建议用户建立专用目录和应用密码。
- **纯静态 SPA 只能连接允许当前 origin 跨域请求（CORS）的 WebDAV 服务**。不得通过 `no-cors` 假装解决；遇到不支持的服务，明确提示服务器需配置 CORS，或用户需自己提供同源/可信代理。
- 在浏览器中保存长期 WebDAV 密码有风险；应支持“仅本次会话”和谨慎的本地保存策略，不声称 IndexedDB 加密就能完全防止 XSS 凭证泄露。

### 8.5 S3-compatible — 第四优先级

- 目标：AWS S3、Cloudflare R2、MinIO、雨云等**兼容的 S3 Endpoint**。要求可配置 Endpoint、Region、Bucket、Prefix、认证方式。
- 浏览器直连要求 Bucket CORS 正确配置；若使用 Access Key / Secret Key 签名，请明确这是个人高级模式，Secret 暴露于该浏览器环境，要求权限最小、限定 Prefix（是否支持取决于服务商 IAM），不允许发布应用统一密钥。
- 推荐支持预签名 URL 或用户自有临时凭证/签名器；这会引入用户自己的辅助服务，不属于 Scratch 自带后端。
- S3 适配不能为了“能用”而绕过浏览器安全限制，出厂默认不保存长期 secret。

## 9. 安全、隐私与可靠性

- 任何富文本 HTML/外部粘贴内容必须进行严格 sanitization；导出/预览避免 XSS。富文本 schema 只允许明确支持的节点与属性。
- 不把第三方云服务凭证加入备份和错误日志；不要 log 原始正文、图片内容或 Token。
- 提供合理 CSP，审查第三方域名连接，仅连接用户明确配置的备份 Provider。
- 不在生产环境启用开放的 source map、敏感调试输出或未验证的依赖 CDN（根据实际项目安全策略判断）。
- 图片和备份大小需设置保守合理的默认限额、明确错误，不要让浏览器因一次超大 ZIP 导入直接 OOM。
- 使用不可变备份快照、校验和、恢复前安全快照以及模拟故障测试。
- 将跨标签页冲突、网络离线、授权失效、存储空间不足、配额限制、浏览器刷新中断列为必须覆盖的失败场景。

## 10. 目录结构

```text
Scratch/
├── public/
│   ├── icons/
│   └── manifest.webmanifest
├── src/
│   ├── app/                 # AppShell / routing / providers
│   ├── core/
│   │   ├── models/
│   │   ├── commands/
│   │   ├── schemas/
│   │   └── document-service.ts
│   ├── features/
│   │   ├── scratches/       # 草稿列表、搜索、回收站
│   │   ├── paper/           # Tiptap + adapter
│   │   ├── canvas/          # tldraw + Shape + adapter
│   │   ├── backup/
│   │   │   ├── archive/
│   │   │   ├── encryption/
│   │   │   ├── providers/
│   │   │   └── ui/
│   │   └── settings/
│   ├── storage/             # Dexie / migrations / repositories / autosave
│   ├── shared/              # 通用组件 / hooks / tokens
│   └── main.tsx
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── architecture.md
│   ├── backup-format.md
│   ├── oauth-setup.md
│   └── decisions/
├── .env.example
├── .github/workflows/ci.yml
├── package.json
└── README.md
```

## 11. 实施顺序与里程碑

### M0 — 仓库与工程基础
- 检查仓库并初始化 Vite/React/TS，代码规范、路由、UI tokens、测试基础、CI。
- 做出真实可交互的 App Shell：侧栏、导航、模式切换、主题切换。
- 输出架构决策文档，记录 tldraw 许可状态。

### M1 — Data Core 与本地持久化
- 完成 Scratch / Block / Layout schema、CRUD、Dexie 和 migration。
- 实现 save queue、自动保存、历史快照、导出和导入校验。
- 测试刷新、崩溃中断模拟、异常数据和跨标签写入冲突。

### M2 — Paper 可用版本
- Tiptap 富文本、Markdown 快捷输入、图片、代码块、草稿管理和搜索。
- 完成截图/交互评估、键盘可用性、深浅色。
- 验收后，Paper 可独立替代旧站常见用途。

### M3 — Canvas 和双模式闭环
- 接入合法可用的 tldraw SDK（或经明确记录的备选引擎）。
- Custom BlockShape、双击编辑、拖放缩放/连线/分组、视图布局持久化。
- 完成 Paper ↔ Canvas 内容一致性和边界条件测试。

### M4 — BYOS 云备份
- 完成 ZIP 备份包协议、校验、版本迁移、加解密、恢复安全流程。
- OneDrive OAuth + API 真正对接（缺少注册配置则 Mock 测试，说明阻塞）；Google Drive / WebDAV / S3 适配按优先级推进。
- 定时检查、手动备份、历史列表、恢复、重试与清理策略。

### M5 — 发布准备
- 完成无障碍与响应式修整，生产构建、离线测试、端到端验收。
- README 安装 / 配置 / 使用 / 导入迁移；提供演示截图、环境变量示例。
- 只提交可核实的测试结果；明确标注授权、域名、许可证等外部阻塞。

## 12. 验收清单（全部需要可验证）

### 文档与编辑
- [ ] 第一次访问自动创建空白草稿且可以立刻输入。
- [ ] 草稿可以新建、重命名、搜索、删除/恢复。
- [ ] 纸张可编辑标题、列表、富文本、代码块、链接、图片。
- [ ] Paper 创建 3 个 Block，在 Canvas 显示 3 个可移动卡片；不混入空白卡片。
- [ ] Canvas 移动卡片、创建连线、修改文字，再切回 Paper，内容和顺序正确。
- [ ] 再返回 Canvas，位置、大小、连线、分组保留。
- [ ] 画布新增卡片后，Paper 的块列表出现相应内容。
- [ ] 重复切换 20 次，无重复块、空块、文字回退或图片丢失。
- [ ] 中文输入法组合输入、跨模式切换、复制粘贴工作正常。

### 本地数据
- [ ] 重新加载页面不丢内容、布局和当前草稿。
- [ ] 浏览器离线时可以进入应用、新建和编辑草稿（在首次缓存成功后）。
- [ ] 自动保存失败会明确告警并支持重试。
- [ ] 备份导出后，清空一个测试数据库，导入可恢复文字、代码、图片、画布布局。
- [ ] 导入非法/损坏/超大包不会覆盖当前数据。
- [ ] 两个标签同时编辑时不会无提示地覆盖旧版本。
- [ ] 不同域名的 IndexedDB 不会被错误声称自动同步。

### 云备份
- [ ] 未连接 Provider 不影响本地使用。
- [ ] OneDrive 能完成真实登录 / 上传 / 列出 / 下载 / 恢复（有测试凭证时）；否则 Mock + 配置指南，明确未验证。
- [ ] 每 30 分钟检查仅在网页打开时运行；无改动不上传。
- [ ] 失败的上传不会覆盖 latest 指针或删除最后一个有效快照。
- [ ] 恢复之前创建本地安全备份并显示清晰确认。
- [ ] 错误密码、失效 OAuth Token、无权限、CORS 失败等均显示可理解错误。
- [ ] JSON/ZIP/云存储不含任何服务商长期凭证。

### UI / 工程
- [ ] 现代简约，没有重视觉特效；在 1440px 桌面、768px 平板、390px 手机上可用。
- [ ] 深色、浅色、系统主题；键盘焦点、空状态、保存失败状态齐全。
- [ ] `typecheck`、`lint`、单元测试、端到端测试、生产 build 正常通过。
- [ ] 不存在假实现的“连接成功”、假导出、空操作按钮。
- [ ] 生产依赖的 tldraw 许可状态明确，未授权不能当作已可部署。

## 13. 交付格式

请在最终执行报告中写明：

1. 实际完成了哪些功能（按 M0–M5）；哪些只是接口/Mock/占位。
2. 仓库结构、关键模型和技术取舍（特别是 Block 映射、Canvas 许可、云凭证安全）。
3. 运行和部署命令；`.env.example` 中每个环境变量如何配置。
4. 测试命令、实际通过数量、未通过项目与复现方式。
5. Demo 路由或截图（如可生成）、已知问题和代码位置。
6. **用户必须亲自做的事**：OAuth 应用注册、供应商账号授权、tldraw 许可、目标域名与部署授权、远端仓库操作。
7. 不要在未获得用户授权的情况下归档旧仓库、推送远端、购买许可证或部署生产环境。

## 14. 权威参考（开发时重新核对）

- tldraw License: https://tldraw.dev/community/license
- tldraw Persistence / Snapshots: https://tldraw.dev/docs/persistence
- tldraw Shapes: https://tldraw.dev/docs/shapes
- Tiptap setContent: https://tiptap.dev/docs/editor/api/commands/content/set-content
- Microsoft Graph OneDrive App Folder: https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder
- Microsoft Graph Permissions: https://learn.microsoft.com/en-us/graph/permissions-reference
- Google Drive appDataFolder: https://developers.google.com/workspace/drive/api/guides/appdata
- Google Drive API scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth

---

**最终产品约束：纸张负责线性记录，画布负责空间整理，内容只有一份；本地优先，BYOS 只做备份；现代简约，功能克制。**
