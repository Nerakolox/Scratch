import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle } from 'lucide-react'
import type { ParseBackupResult } from '../archive/format'
import { isBackupError, errorMessage } from '../errors'
import { useBackupService } from '@/features/workspace/WorkspaceContext'
import { Button, Dialog, inputClass } from '@/shared/ui'
import { toast } from '@/shared/toast'
import { formatBytes, formatDateTime } from '@/shared/format'

interface PendingArchive {
  blob: Blob
  source: string
  size: number
}

interface PreviewArchive {
  result: ParseBackupResult
  source: string
  size: number
}

export interface RestoreApi {
  openLocalFile: (file: File) => Promise<void>
  openBlob: (blob: Blob, source: string) => Promise<void>
  openRemote: (id: string, name: string) => Promise<void>
}

const RestoreContext = createContext<RestoreApi | null>(null)

export function RestoreProvider({ children }: { children: ReactNode }) {
  const backup = useBackupService()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingArchive | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [preview, setPreview] = useState<PreviewArchive | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inspect = useCallback(
    async (blob: Blob, source: string, archivePassword?: string) => {
      setBusy(true)
      setError(null)
      try {
        const result = await backup.inspectArchive(blob, archivePassword)
        setPreview({ result, source, size: blob.size })
        setPasswordOpen(false)
        setPending(null)
      } catch (inspectError) {
        if (isBackupError(inspectError) && inspectError.code === 'password-required') {
          setPending({ blob, source, size: blob.size })
          setPasswordOpen(true)
        } else {
          const message = errorMessage(inspectError)
          setError(message)
          toast(message, 'error')
        }
      } finally {
        setBusy(false)
      }
    },
    [backup],
  )

  const openLocalFile = useCallback(
    async (file: File) => {
      await inspect(file, file.name)
    },
    [inspect],
  )

  const openBlob = useCallback(
    async (blob: Blob, source: string) => {
      await inspect(blob, source)
    },
    [inspect],
  )

  const openRemote = useCallback(
    async (id: string, name: string) => {
      setBusy(true)
      setError(null)
      try {
        const blob = await backup.downloadRemote(id)
        await inspect(blob, name)
      } catch (downloadError) {
        const message = errorMessage(downloadError)
        setError(message)
        toast(message, 'error')
      } finally {
        setBusy(false)
      }
    },
    [backup, inspect],
  )

  const api = useMemo<RestoreApi>(
    () => ({ openLocalFile, openBlob, openRemote }),
    [openLocalFile, openBlob, openRemote],
  )

  const closePassword = () => {
    setPasswordOpen(false)
    setPending(null)
    setPassword('')
    setError(null)
  }

  const submitPassword = async () => {
    if (!pending) return
    await inspect(pending.blob, pending.source, password)
  }

  const closePreview = () => {
    if (busy) return
    setPreview(null)
    setError(null)
    setPassword('')
  }

  const confirmRestore = async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      await backup.applyRestore(preview.result.dataset, {
        source: preview.source,
        manifest: preview.result.manifest,
      })
      toast('恢复完成，本地数据已替换', 'success')
      setPreview(null)
      setPassword('')
    } catch (restoreError) {
      const message = errorMessage(restoreError)
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const manifest = preview?.result.manifest
  const warnings = preview?.result.warnings ?? []

  return (
    <RestoreContext.Provider value={api}>
      {children}

      <Dialog
        open={passwordOpen}
        onClose={closePassword}
        title="此备份已加密"
        description="请输入创建备份时设置的密码。密码不会被保存；遗忘密码将无法恢复该备份。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closePassword}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={password.length === 0}
              onClick={() => void submitPassword()}
            >
              解密并检查
            </Button>
          </>
        }
      >
        <input
          type="password"
          className={inputClass}
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitPassword()
          }}
          placeholder="备份密码"
          aria-label="备份密码"
        />
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      </Dialog>

      <Dialog
        open={Boolean(preview)}
        onClose={closePreview}
        title="恢复备份到本机"
        description="恢复会整体替换当前浏览器内的所有草稿（包括回收站）。恢复前会自动保存一份当前数据的安全备份。"
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closePreview} disabled={busy}>
              取消
            </Button>
            <Button variant="danger" size="sm" loading={busy} onClick={() => void confirmRestore()}>
              恢复并替换全部数据
            </Button>
          </>
        }
      >
        {manifest && preview && (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-lg bg-sunken/60 px-3 py-2">
                <dt className="text-faint">来源</dt>
                <dd className="mt-0.5 break-all text-ink">{preview.source}</dd>
              </div>
              <div className="rounded-lg bg-sunken/60 px-3 py-2">
                <dt className="text-faint">备份时间</dt>
                <dd className="mt-0.5 text-ink">{formatDateTime(Date.parse(manifest.createdAt))}</dd>
              </div>
              <div className="rounded-lg bg-sunken/60 px-3 py-2">
                <dt className="text-faint">草稿 / 内容块 / 图片</dt>
                <dd className="mt-0.5 text-ink">
                  {preview.result.dataset.scratches.length} /{' '}
                  {preview.result.dataset.blocks.length} /{' '}
                  {preview.result.dataset.assets.length}
                </dd>
              </div>
              <div className="rounded-lg bg-sunken/60 px-3 py-2">
                <dt className="text-faint">文件大小 / 版本</dt>
                <dd className="mt-0.5 text-ink">
                  {formatBytes(preview.size)} · v{manifest.appVersion}
                </dd>
              </div>
            </dl>

            {warnings.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11.5px] leading-relaxed text-ink">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle size={13} className="text-warning" aria-hidden />
                  备份兼容性提示
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                  {warnings.slice(0, 6).map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                  {warnings.length > 6 && <li>还有 {warnings.length - 6} 条提示…</li>}
                </ul>
              </div>
            )}

            {error && <p className="text-[12px] text-danger">{error}</p>}
          </div>
        )}
      </Dialog>
    </RestoreContext.Provider>
  )
}

export function useRestore(): RestoreApi {
  const api = useContext(RestoreContext)
  if (!api) throw new Error('useRestore must be used inside RestoreProvider')
  return api
}
