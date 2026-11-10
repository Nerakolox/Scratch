import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download,
  FileArchive,
  FileDown,
  HardDriveDownload,
  RotateCcw,
  Upload,
} from 'lucide-react'
import { collectAssetIds, nodesToMarkdown } from '@/core/content'
import { buildZip } from '../archive/zip'
import { errorMessage } from '../errors'
import { useBackupService, useDocumentService, useServiceState } from '@/features/workspace/WorkspaceContext'
import type { SafetyBackupRecord } from '@/storage/db'
import { Button, Dialog, Field, inputClass } from '@/shared/ui'
import { toast } from '@/shared/toast'
import { downloadBlob, safeFilename } from '@/shared/download'
import { formatBytes, formatDateTime } from '@/shared/format'
import { useRestore } from './restore'

const checkboxClass = 'h-4 w-4 rounded border-line accent-[var(--scratch-accent)]'

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
}

export function DataPanel() {
  const service = useDocumentService()
  const backup = useBackupService()
  const state = useServiceState()
  const restore = useRestore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [encrypt, setEncrypt] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [safety, setSafety] = useState<SafetyBackupRecord[]>([])
  const [persisted, setPersisted] = useState<boolean | null>(null)

  const refreshSafety = useCallback(async () => {
    try {
      setSafety(await backup.listSafetyBackups())
    } catch {
      setSafety([])
    }
  }, [backup])

  useEffect(() => {
    void refreshSafety()
    if (navigator.storage?.persisted) {
      navigator.storage
        .persisted()
        .then(setPersisted)
        .catch(() => setPersisted(null))
    }
  }, [refreshSafety])

  const exportFullBackup = async () => {
    if (encrypt) {
      if (password.length < 8) {
        toast('加密密码至少需要 8 个字符', 'error')
        return
      }
      if (password !== confirmPassword) {
        toast('两次输入的密码不一致', 'error')
        return
      }
    }
    setBusy(true)
    try {
      const archive = await backup.createArchive({
        password: encrypt ? password : undefined,
      })
      downloadBlob(archive.blob, archive.filename)
      setExportOpen(false)
      setPassword('')
      setConfirmPassword('')
      toast(
        encrypt ? '已导出加密备份文件，请妥善保管密码' : '已导出完整备份文件',
        'success',
      )
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const exportMarkdown = async () => {
    const scratch = state.session.scratch
    if (!scratch) return
    setBusy(true)
    try {
      const nodes = state.session.blocks.map((block) => block.content.node)
      let markdown = nodesToMarkdown(nodes, scratch.title)
      const assetIds = new Set<string>()
      for (const node of nodes) collectAssetIds(node, assetIds)

      if (assetIds.size === 0) {
        downloadBlob(
          new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
          `${safeFilename(scratch.title, '草稿')}.md`,
        )
        toast('已导出 Markdown', 'success')
        return
      }

      const files: Record<string, Uint8Array> = {}
      for (const assetId of assetIds) {
        const blob = await service.getAssetBlob(assetId)
        if (!blob) continue
        const extension = EXTENSION_BY_MIME[blob.type] ?? 'bin'
        const fileName = `${assetId}.${extension}`
        markdown = markdown.split(`scratch-asset:${assetId}`).join(`assets/${fileName}`)
        files[`assets/${fileName}`] = new Uint8Array(await blob.arrayBuffer())
      }
      files[`${safeFilename(scratch.title, '草稿')}.md`] = new TextEncoder().encode(markdown)
      const zip = buildZip(files)
      downloadBlob(
        new Blob([zip as BlobPart], { type: 'application/zip' }),
        `${safeFilename(scratch.title, '草稿')}-markdown.zip`,
      )
      toast('已导出 Markdown 与图片压缩包', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const requestPersistence = async () => {
    if (!navigator.storage?.persist) {
      toast('此浏览器不支持持久化存储申请', 'error')
      return
    }
    try {
      const granted = await navigator.storage.persist()
      setPersisted(granted)
      toast(
        granted
          ? '浏览器已允许持久化存储'
          : '浏览器未授予持久化存储，建议定期导出备份',
        granted ? 'success' : 'info',
      )
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <FileArchive size={15} className="text-accent" aria-hidden />
          完整备份（.scratchbackup）
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
          包含所有草稿、回收站、图片与画布布局。恢复时整体替换本机数据，并在替换前自动保存安全备份。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<Download size={14} />}
            onClick={() => setExportOpen(true)}
          >
            导出完整备份
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Upload size={14} />}
            onClick={() => fileInputRef.current?.click()}
          >
            从备份文件恢复…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<FileDown size={14} />}
            disabled={!state.session.scratch || busy}
            onClick={() => void exportMarkdown()}
          >
            导出当前草稿 Markdown
          </Button>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
          Markdown 导出会保留文字格式与图片引用，但不包含画布空间布局；需要完整迁移时请使用 .scratchbackup。
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".scratchbackup,application/zip,application/octet-stream"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void restore.openLocalFile(file)
          }}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <HardDriveDownload size={15} className="text-muted" aria-hidden />
            本地安全备份
          </h3>
          <button
            type="button"
            className="text-[11.5px] text-muted hover:text-ink"
            onClick={() => void refreshSafety()}
          >
            刷新
          </button>
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
          每次恢复前自动保存，最多保留 5 份。可下载留档，也可直接恢复。
        </p>
        {safety.length === 0 ? (
          <p className="mt-3 text-[12px] text-faint">还没有安全备份。</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {safety.map((record) => (
              <li key={record.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-ink">{record.reason}</p>
                  <p className="text-[10.5px] text-faint">
                    {formatDateTime(record.createdAt)} · {formatBytes(record.size)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Download size={13} />}
                  onClick={() => downloadBlob(record.blob, `scratch-safety-${record.id}.scratchbackup`)}
                >
                  下载
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw size={13} />}
                  onClick={() =>
                    void restore.openBlob(
                      record.blob,
                      `本地安全备份 · ${formatDateTime(record.createdAt)}`,
                    )
                  }
                >
                  恢复
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-[13px] font-semibold text-ink">浏览器存储</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
          申请“持久化存储”可降低浏览器在空间不足时清理本地数据的概率，但不等于备份。
          {persisted === true
            ? ' 当前已获得持久化存储。'
            : persisted === false
              ? ' 当前未获得持久化存储。'
              : ''}
        </p>
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={() => void requestPersistence()}>
            {persisted ? '重新检查 / 申请' : '申请持久化存储'}
          </Button>
        </div>
      </div>

      <Dialog
        open={exportOpen}
        onClose={() => {
          if (!busy) setExportOpen(false)
        }}
        title="导出完整备份"
        description="生成 .scratchbackup 文件，包含全部草稿、图片和画布布局。"
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setExportOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={() => void exportFullBackup()}>
              生成并下载
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-[12.5px] text-ink">
            <input
              type="checkbox"
              className={`${checkboxClass} mt-0.5`}
              checked={encrypt}
              onChange={(event) => setEncrypt(event.target.checked)}
            />
            <span>
              加密此备份（AES-256-GCM）
              <span className="mt-0.5 block text-[11px] text-faint">
                密码不会保存，遗忘后无法恢复。
              </span>
            </span>
          </label>
          {encrypt && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="密码" hint="至少 8 个字符">
                <input
                  type="password"
                  className={inputClass}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="确认密码">
                <input
                  type="password"
                  className={inputClass}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  )
}
