# `.scratchbackup` 格式（formatVersion 1）

Scratch 的完整备份是一个 ZIP 容器，扩展名 `.scratchbackup`。它不依赖增量包，单个文件即可独立恢复；包含所有草稿（含回收站）、内容块、纸张顺序、画布快照与图片资源。

## 1. 未加密布局

```text
scratchbackup-20261110T120000Z-1a2b3c4d.scratchbackup
├── manifest.json
├── scratches.json
├── blocks.json
├── paper-layouts.json
├── canvas-layouts.json
└── assets/
    ├── <asset-id>.png
    ├── <asset-id>.jpg
    └── <asset-id>.webp
```

- 数据文件是 UTF-8 JSON 数组。
- 资源文件名 = `assetId + 扩展名`；ID 必须匹配 `^[A-Za-z0-9._-]{1,128}$`，防止路径注入。
- 图片 MIME 由扩展名决定：`png jpg jpeg gif webp svg avif heic bin`；未知扩展名按 `application/octet-stream` 处理并给出警告。
- ZIP 内不允许绝对路径、`..`、反斜杠或重复文件名。

## 2. manifest.json

```json
{
  "format": "duskbit.scratch.backup",
  "formatVersion": 1,
  "createdAt": "2026-11-10T12:00:00.000Z",
  "appVersion": "0.1.0",
  "datasetId": "uuid",
  "scratchCount": 4,
  "assetCount": 2,
  "payloadSha256": "<64 hex>"
}
```

`datasetId` 在本机首次备份时生成并保存在设置中，用于标识同一数据来源，不参与内容校验。

## 3. payloadSha256 的精确定义

`manifest.json` **不参与**自身哈希。对其余所有 ZIP 成员：

1. 按成员名做字节序（UTF-8 代码单元）升序排序。
2. 对每个成员计算原始文件字节的 SHA-256（十六进制小写）。
3. 依次拼接字符串：`"<name>\n<sha256>\n"`。
4. 对整个拼接结果再算一次 SHA-256（UTF-8），得到 `payloadSha256`。

解析时会重新计算并严格比较；任何文件内容、文件名或增删都会导致校验失败。实现见 `src/features/backup/archive/format.ts` 的 `computePayloadHash()`。

`scratchCount` / `assetCount` 必须与实际数组/资源文件数量一致；`blockCount` 不作为 manifest 字段（可由 `blocks.json` 长度得到）。

## 4. 加密封装

开启加密时，外层仍是 ZIP，但只包含：

```text
scratchbackup-….scratchbackup
├── header.json      # 明文头，不含正文
└── payload.bin      # 加密后的内层 ZIP（第 1 节结构）
```

`header.json`：

```json
{
  "format": "duskbit.scratch.encrypted",
  "formatVersion": 1,
  "cipher": "AES-256-GCM",
  "kdf": "PBKDF2-SHA-256",
  "iterations": 310000,
  "salt": "<base64 16 bytes>",
  "iv": "<base64 12 bytes>"
}
```

- 密码通过 `TextEncoder` 转 UTF-8；PBKDF2 派生 256-bit 密钥；每个备份独立随机 salt/IV。
- AES-GCM 认证标签 128 bit；解密失败统一报告“密码错误或文件已被篡改”，不泄露更多信息。
- 密码至少 8 个字符；不写入备份包、不写入磁盘、不上传。自动备份如需加密，必须在当前浏览会话内显式记住密码（仅内存）。
- 明文头只含版本与 KDF 参数，不含草稿正文、图片或文件名。

## 5. 导入校验与限制

解析顺序（`parseBackupArchive`）：

1. 文件总大小 ≤ 256 MB（`VITE_MAX_BACKUP_BYTES` 可覆盖）。
2. 解析 ZIP 中央目录：条目数 ≤ 20,000，单文件解压 ≤ 100 MB，总解压 ≤ 512 MB；拒绝 ZIP64 超大条目。**在解压前**完成，防压缩炸弹。
3. 如存在 `header.json`：校验头、要求密码、解密 `payload.bin`，再对内层 ZIP 重复中央目录检查。
4. 解析并校验 `manifest.json` 的 `format` 与 `formatVersion`；未知版本明确报错，不猜测。
5. 重算 `payloadSha256`。
6. 用 Zod 校验全部记录；检查 Scratch/Block 引用、重复 ID、布局引用；自动修复“顺序缺少块/重复引用”并记录 warnings；缺失图片资源保留 Block 并警告（渲染为占位符）。
7. 校验图片 magic bytes 与扩展名一致。
8. 全部通过后才进入恢复流程；任何失败不会写入本地数据库。

## 6. 恢复语义

- v1 只支持**整体替换**：清空 `scratches/blocks/paperLayouts/canvasLayouts/assets` 后写入包内容；回收站记录也来自备份。
- 恢复前：
  1. flush 当前编辑；
  2. 导出当前完整数据集为未加密 `.scratchbackup` 存入本地 `safetyBackups`（最多 5 份）；
  3. 写一份 pre-restore 历史快照；
  4. 在单个 Dexie 事务内替换。
- 恢复失败时重新打开原草稿；本地数据保持原样。
- 不实现按 ID 合并导入（未来版本可基于同一格式增加 merge 策略）。

## 7. 命名、校验与保留

- 备份文件名：`scratchbackup-<UTC yyyyMMddTHHmmss>Z-<8 hex>.scratchbackup`。
- 上传后 Provider 列表回读，按 name/id 查找并比较大小；找不到或大小不符不记录成功。
- 成功后才写入本地 `backup.last`（`{ at, size, name, provider, datasetRevision }`）。这是本地“latest 指针”；云端没有单独的可写指针文件。
- 自动清理仅针对同一 Provider、同一前缀下匹配 `scratchbackup-*.scratchbackup` 的对象，保留最近 N 份（默认 10，最少 1），绝不删除刚上传或比保留窗口更新的快照。
- 任何备份与 Provider 配置中都不包含 OAuth Token、WebDAV 密码、S3 Secret 等凭证。

## 8. 版本演进

`formatVersion` 未来提升时：

- 解析器先读 `format`/`formatVersion`，不兼容则报 `unsupported-version`。
- 增加字段应向后兼容；破坏性变更必须提升版本并提供显式迁移入口。
- v1 不包含增量/差分数据。
