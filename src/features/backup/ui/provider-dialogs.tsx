import { useEffect, useState } from 'react'
import { useBackupService } from '@/features/workspace/WorkspaceContext'
import { Button, Dialog, Field, inputClass } from '@/shared/ui'
import { toast } from '@/shared/toast'
import { errorMessage } from '../errors'
import { WebDavProvider } from '../providers/webdav'
import { S3Provider, type S3Config } from '../providers/s3'

const checkboxClass = 'h-4 w-4 rounded border-line accent-[var(--scratch-accent)]'

export function WebDavDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const backup = useBackupService()
  const provider = backup.getProvider('webdav') as WebDavProvider
  const [baseUrl, setBaseUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setPassword('')
    void provider.readConfig().then((config) => {
      if (!config) return
      setBaseUrl(config.baseUrl)
      setUsername(config.username)
      setRemember(config.rememberPassword)
    })
  }, [open, provider])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await provider.configure({
        baseUrl,
        username,
        password,
        rememberPassword: remember,
      })
      await backup.refreshProviders()
      await backup.setActiveProvider('webdav')
      toast('WebDAV 已连接', 'success')
      onClose()
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="配置 WebDAV"
      description="建议为 Scratch 建立独立目录与应用密码。网页直连要求该服务允许当前站点的 CORS 请求。"
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
            保存并测试
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="目录 URL" hint="例如 https://cloud.example.com/remote.php/dav/files/user/Scratch/">
          <input
            className={inputClass}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://…/Scratch/"
            autoFocus
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="用户名">
            <input
              className={inputClass}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field label="密码 / 应用密码">
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-[12px] text-muted">
          <input
            type="checkbox"
            className={`${checkboxClass} mt-0.5`}
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>
            在本机记住密码（写入 IndexedDB）。不勾选时密码只保存在本次浏览器会话中；两者都无法抵御 XSS。
          </span>
        </label>
        {error && <p className="text-[12px] leading-relaxed text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}

const EMPTY_S3: S3Config = {
  endpoint: '',
  region: 'auto',
  bucket: '',
  prefix: 'scratch/',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
}

export function S3Dialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const backup = useBackupService()
  const provider = backup.getProvider('s3') as S3Provider
  const [form, setForm] = useState<S3Config>(EMPTY_S3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    void provider.readConfig().then((config) => {
      if (!config) {
        setForm(EMPTY_S3)
        return
      }
      setForm({
        ...config,
        secretAccessKey: '',
        sessionToken: '',
      })
    })
  }, [open, provider])

  const update = (patch: Partial<S3Config>) => setForm((current) => ({ ...current, ...patch }))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await provider.configure(form)
      await backup.refreshProviders()
      await backup.setActiveProvider('s3')
      toast('S3 兼容存储已连接', 'success')
      onClose()
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="配置 S3 兼容存储"
      description="适用于 AWS S3、Cloudflare R2、MinIO 等。浏览器直连要求 Bucket 配置允许本站点的 CORS。"
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
            保存并测试
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Endpoint" hint="仅填写协议与域名，例如 https://<account>.r2.cloudflarestorage.com">
          <input
            className={inputClass}
            value={form.endpoint}
            onChange={(event) => update({ endpoint: event.target.value })}
            placeholder="https://s3.example.com"
            autoFocus
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Region">
            <input
              className={inputClass}
              value={form.region}
              onChange={(event) => update({ region: event.target.value })}
              placeholder="auto"
            />
          </Field>
          <Field label="Bucket">
            <input
              className={inputClass}
              value={form.bucket}
              onChange={(event) => update({ bucket: event.target.value })}
            />
          </Field>
          <Field label="Key 前缀" hint="只使用该前缀下的 scratchbackup-* 对象">
            <input
              className={inputClass}
              value={form.prefix}
              onChange={(event) => update({ prefix: event.target.value })}
              placeholder="scratch/"
            />
          </Field>
          <Field label="Access Key ID">
            <input
              className={inputClass}
              value={form.accessKeyId}
              onChange={(event) => update({ accessKeyId: event.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label="Secret Access Key" hint="不会回显；每次保存需重新填写。">
            <input
              type="password"
              className={inputClass}
              value={form.secretAccessKey}
              onChange={(event) => update({ secretAccessKey: event.target.value })}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Session Token（可选）">
            <input
              type="password"
              className={inputClass}
              value={form.sessionToken ?? ''}
              onChange={(event) => update({ sessionToken: event.target.value })}
              autoComplete="off"
            />
          </Field>
        </div>
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11.5px] leading-relaxed text-muted">
          长期密钥会保存在本浏览器中，任何 XSS 都可能读取它。请使用权限最小、仅允许该 Bucket/前缀的专用密钥。
          Scratch 不会把密钥写入备份包或日志。
        </p>
        {error && <p className="text-[12px] leading-relaxed text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}
