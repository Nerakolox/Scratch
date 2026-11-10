# OAuth 配置（OneDrive / Google Drive）

Scratch 是纯静态 SPA，使用 **Authorization Code + PKCE** 的公共客户端流程，**不包含任何 Client Secret**。回调页是应用自身的 origin（默认 `https://<你的域名>/`），在 popup 中完成授权后把 `code` 通过 `postMessage` 交给主窗口。

> 开发环境注册 `http://localhost:5173/`；生产环境注册实际部署地址。两者不同 origin 时请分别注册或使用多重重定向 URI。

## 1. Microsoft OneDrive

### 1.1 在 Microsoft Entra 注册应用

1. 打开 [Microsoft Entra admin center](https://entra.microsoft.com/) → **应用注册** → 新注册。
2. 名称任意（如 `Scratch`）；支持的账户类型按需选择（个人微软账号选“仅个人 Microsoft 账户”，或包含工作/学校账户）。
3. **身份验证** → 添加平台 → **单页应用程序 (SPA)**：
   - 重定向 URI：`http://localhost:5173/`（开发）与生产地址。
   - 不要勾选隐式授权。
4. **API 权限** → Microsoft Graph → 委托权限 → 添加 `Files.ReadWrite.AppFolder`；必要时授予管理员同意/用户同意。
   - 该委派权限在微软文档中仍标注为 Preview，需目标账号/租户实际支持；Scratch 不会为“能用”而偷偷改成 `Files.ReadWrite.All`。
5. **证书和密码**：不需要创建客户端密码。复制 **应用程序(客户端) ID**。

### 1.2 配置 Scratch

```dotenv
VITE_ONEDRIVE_CLIENT_ID=<应用程序客户端 ID>
VITE_ONEDRIVE_TENANT=consumers
VITE_ONEDRIVE_REDIRECT_URI=http://localhost:5173/
```

- `VITE_ONEDRIVE_TENANT`：个人账号用 `consumers`；组织账号可用 `organizations` 或具体 tenant ID。
- `VITE_ONEDRIVE_REDIRECT_URI` 必须与 Entra 中注册的 URI **完全一致**（含末尾斜杠）。
- 重启 Vite 使环境变量生效。

### 1.3 Scratch 使用的 Graph 范围

- 读写仅限 `/me/drive/special/approot`（应用专属文件夹），文件直接放在该文件夹下，命名 `scratchbackup-*.scratchbackup`。
- 小文件（≤4 MiB）使用简单 PUT；更大文件创建 upload session 并按 5 MiB 分片上传。
- 列表、下载、删除均使用应用文件夹内条目 ID/路径。
- Token 用 refresh token 静默刷新；401 时刷新一次后重试；失效时 UI 提示重新连接。

## 2. Google Drive

### 2.1 在 Google Cloud Console 创建 OAuth 客户端

1. 创建/选择项目，启用 **Google Drive API**。
2. **OAuth 同意屏幕**：配置应用名称、支持邮箱；测试阶段把需要使用的 Google 账号加入测试用户。
3. **凭据** → 创建凭据 → **OAuth 客户端 ID** → 应用类型 **Web 应用**：
   - 已获授权的 JavaScript 来源：`http://localhost:5173`、生产 origin。
   - 已获授权的重定向 URI：`http://localhost:5173/`、生产回调地址。
4. 复制 Client ID（不需要 Client Secret）。

### 2.2 配置 Scratch

```dotenv
VITE_GOOGLE_CLIENT_ID=<Web Client ID>
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/
```

### 2.3 范围与行为

- Scope：`https://www.googleapis.com/auth/drive.appdata`。
- 文件写入 `appDataFolder`：**普通 Google Drive 界面不可见**；用户移除应用或清理应用数据会影响这些备份。
- 使用离线访问（`access_type=offline`、`prompt=consent`）以获得 refresh token；刷新失败会提示重新授权。
- 上传使用 multipart；列表限定 `appDataFolder` 与 `scratchbackup-` 名称前缀。

## 3. 回传机制与安全

- 授权 popup 回到应用 origin 后，`main.tsx` 检测 `window.opener + ?code/?error`，只渲染一个极小的 relay 页面，将结果 `postMessage` 给主窗口并自行关闭。
- 主窗口校验 `event.origin` 与 `state`；state 带 provider 前缀，防止串用。
- PKCE verifier/state 只存 sessionStorage，用后即删。
- OAuth access/refresh token 保存在 IndexedDB 的 `settings` 中，用于静默续期；**任何 XSS 都可能读取它们**。Scratch 不把 Token 放入备份、导出或日志。
- “断开”会删除本机 Token；云端已有备份文件保持不变。

## 4. 没有凭证时会发生什么

- 设置页卡片明确显示“需配置”，连接按钮禁用，并提示本文件。
- 未配置不影响本地编辑；WebDAV / S3 可直接通过界面填写自有配置进行真实使用（需服务端 CORS）。
- 自动化测试使用内存 FakeProvider 验证备份/恢复流程，不以“假连接成功”冒充真实 OneDrive/Google 验证。
