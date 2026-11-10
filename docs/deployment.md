# 部署

Scratch 是纯前端 SPA + PWA，没有自建后端。构建产物在 `dist/`，可部署到任何静态托管（Cloudflare Pages、Netlify、Vercel、GitHub Pages、对象存储 + CDN 等）。

## 1. 构建

```bash
cp .env.example .env.production
# 填入 VITE_TLDRAW_LICENSE_KEY、OAuth Client ID、生产域名等
npm ci
npm run build
```

Vite 的 `VITE_*` 变量在**构建时**写入产物；不同域名/环境请分别构建。不要让生产构建缺少 tldraw license 却对外宣称已可发布。

## 2. 路由

应用使用 `HashRouter`（`/#/settings`），因此：

- 服务器只需对 `/` 返回 `index.html`，无需为子路径配置 SPA fallback。
- PWA `start_url` 为 `/`；离线回退由 Workbox 处理。

## 3. HTTPS 与域名

以下能力要求安全上下文（HTTPS 或 `localhost`）：

- Web Crypto（备份加密、S3 签名、资源 SHA-256）
- Service Worker / PWA 安装
- 现代剪贴板与部分存储 API

计划域名：优先 `editor.nerakolo.cc`，未来可迁移 `scratch.duskbit.dev`。**不同域名是不同 origin，IndexedDB 不会随域名迁移**。迁移流程：

1. 旧域名打开 Scratch → 设置 → 导出完整 `.scratchbackup`。
2. 新域名打开 → 从备份文件恢复（可加密）。
3. 确认内容、图片、画布布局后，再停用旧域名。

## 4. OAuth 回调

OneDrive / Google 的重定向 URI 必须与部署 origin 完全一致：

- `VITE_ONEDRIVE_REDIRECT_URI=https://<domain>/`
- `VITE_GOOGLE_REDIRECT_URI=https://<domain>/`

在对应控制台登记所有实际使用的 URI（开发与生产可以同时登记）。

## 5. 推荐的响应头

建议在托管平台配置：

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:;
  font-src 'self' data:;
  connect-src 'self'
    https://graph.microsoft.com
    https://login.microsoftonline.com
    https://www.googleapis.com
    https://oauth2.googleapis.com
    https://accounts.google.com
    <用户自有的 WebDAV / S3 Endpoint>;
  worker-src 'self' blob:;
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
```

说明：

- tldraw 与 Tiptap 会使用内联 `style` 属性，因此 `style-src` 需要 `'unsafe-inline'`；脚本不需要 `unsafe-eval`。
- 如果用户使用自定义 WebDAV / S3 endpoint，CSP 必须允许该域名（或由你提供同源代理）。这是 BYOS 的固有配置成本。
- 其余安全头：

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin-allow-popups   # OAuth popup 需要
```

- 缓存：

```text
/sw.js            Cache-Control: no-cache
/index.html       Cache-Control: no-cache
/assets/*         Cache-Control: public, max-age=31536000, immutable
```

## 6. PWA

- `vite-plugin-pwa` 生成 `sw.js`、`manifest.webmanifest` 与预缓存清单。
- 只缓存静态资源；`runtimeCaching: []`，不会缓存 OneDrive/Google/WebDAV/S3 的 API 响应或凭证。
- 更新策略为 `autoUpdate`；新版本会在下一次加载/刷新时激活。

## 7. OneDrive / WebDAV / S3 的 CORS

- **OneDrive**：Graph 支持浏览器直连，仍需确认组织策略允许。
- **Google Drive**：官方 API 支持浏览器直连。
- **WebDAV**：必须允许当前站点 origin 的 `PROPFIND / MKCOL / PUT / GET / DELETE`（含 `Authorization` 头）。不支持 CORS 的服务无法被浏览器直连；Scratch 会明确报错，不会用 `no-cors` 假装成功。可自建同源/可信代理。
- **S3 兼容**：Bucket CORS 至少允许 `GET, PUT, HEAD, DELETE`，允许头 `authorization, content-type, x-amz-date, x-amz-content-sha256, x-amz-security-token`（如使用），暴露头按需。浏览器会发送预检请求。

## 8. 发布前检查

```bash
npm run check
npx playwright test
npm run test:e2e:offline
```

- 确认 `.env.production` 含 tldraw license，否则画布水印与许可阻塞仍存在。
- 验证 OAuth 回调域名、PWA 安装、离线启动、备份导出/恢复。
- 不要把 `.env`、Token、Provider 凭证提交到仓库。
