import { useEffect, useState } from 'react'
import {
  Cloud,
  CloudUpload,
  HardDrive,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldCheck,
  Unlink,
} from 'lucide-react'
import clsx from 'clsx'
import { useBackupService, useBackupState } from '@/features/workspace/WorkspaceContext'
import { Button, Dialog, Field, inputClass } from '@/shared/ui'
import { toast } from '@/shared/toast'
import { formatBytes, formatDateTime } from '@/shared/format'
import { errorMessage } from '../errors'
import type { ProviderId } from '../providers/types'
import { WebDavDialog, S3Dialog } from './provider-dialogs'
import { useRestore } from './restore'

const PROVIDER_IDS: ProviderId[] = ['onedrive', 'google-drive', 'webdav', 's3']
const checkboxClass = 'h-4 w-4 rounded border-line accent-[var(--scratch-accent)]'

export function BackupPanel() {
  const backup = useBackupService()
  const state = useBackupState()
  const restore = useRestore()
  const [webdavOpen, setWebdavOpen] = useState(false)
  const [s3Open, setS3Open] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [rememberPassword, setRememberPassword] = useState(true)
  const [sessionPasswordDraft, setSessionPasswordDraft] = useState('')
  const [disconnectTarget, setDisconnectTarget] = useState<ProviderId | null>(null)

  const activeId = state.settings.providerId
  const activeProvider = activeId ? state.providers[activeId] : null
  const lastBackup =
    state.lastBackup && state.lastBackup.provider === activeId ? state.lastBackup : null

  useEffect(() => {
    void backup.refreshHistory().catch(() => undefined)
  }, [backup])

  const connect = async (id: ProviderId) => {
    setBusyAction(`connect:${id}`)
    try {
      await backup.connectProvider(id)
      toast(`${state.providers[id].label} 已连接`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const disconnect = async (id: ProviderId) => {
    setDisconnectTarget(null)
    setBusyAction(`disconnect:${id}`)
    try {
      await backup.disconnectProvider(id)
      toast('已断开备份服务', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const setActive = async (id: ProviderId) => {
    await backup.setActiveProvider(id)
    await backup.refreshHistory().catch(() => undefined)
  }

  const refreshHistory = async () => {
    setRefreshing(true)
    try {
      await backup.refreshHistory()
    } finally {
      setRefreshing(false)
    }
  }

  const startManualBackup = async (password?: string) => {
    setBusyAction('backup')
    try {
      await backup.runBackup({ password, manual: true })
      toast('云端备份完成', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const requestBackup = () => {
    if (state.settings.encryptionEnabled && !state.hasSessionPassword) {
      setPasswordDraft('')
      setPasswordOpen(true)
      return
    }
    void startManualBackup()
  }

  const submitBackupPassword = () => {
    if (passwordDraft.length < 8) {
      toast('密码至少需要 8 个字符', 'error')
      return
    }
    if (rememberPassword) backup.setSessionPassword(passwordDraft)
    setPasswordOpen(false)
    void startManualBackup(passwordDraft)
  }

  const saveSessionPassword = () => {
    if (sessionPasswordDraft.length < 8) {
      toast('密码至少需要 8 个字符', 'error')
      return
    }
    backup.setSessionPassword(sessionPasswordDraft)
    setSessionPasswordDraft('')
    toast('已在本次会话中记住密码（不会写入磁盘）', 'success')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
              <Cloud size={15} className="text-accent" aria-hidden />
              备份状态
            </h3>
            <p className="mt-1 text-[12px] text-muted">
              {activeProvider
                ? `当前服务：${activeProvider.label}（${activeProvider.connected ? '已连接' : '未连接'}）`
                : '尚未选择云端备份服务。本地编辑不受影响。'}
            </p>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {lastBackup
                ? `上次成功备份：${formatDateTime(lastBackup.at)} · ${formatBytes(lastBackup.size)}`
                : '还没有从此设备完成过备份。'}
            </p>
            {state.message && <p className="mt-1 text-[11.5px] text-success">{state.message}</p>}
            {state.error && (
              <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-danger">{state.error}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<CloudUpload size={14} />}
              loading={busyAction === 'backup'}
              disabled={!activeId || !activeProvider?.connected || state.running}
              onClick={requestBackup}
            >
              立即备份
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />}
              disabled={!activeId}
              onClick={() => void refreshHistory()}
            >
              刷新列表
            </Button>
          </div>
        </div>

        {state.running && state.progress !== null && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.round(state.progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-faint">
              {state.message ?? '正在备份…'} {Math.round(state.progress * 100)}%
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {PROVIDER_IDS.map((id) => {
          const provider = state.providers[id]
          const active = activeId === id
          const connecting = busyAction === `connect:${id}`
          const disconnecting = busyAction === `disconnect:${id}`
          return (
            <div
              key={id}
              className={clsx(
                'flex flex-col rounded-xl border p-4',
                active ? 'border-accent/50 bg-surface' : 'border-line bg-surface/70',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                    <HardDrive size={14} className={active ? 'text-accent' : 'text-faint'} aria-hidden />
                    {provider.label}
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                    {provider.description}
                  </p>
                </div>
                <span
                  className={clsx(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                    active
                      ? 'bg-accent-soft text-accent'
                      : provider.connected
                        ? 'bg-sunken text-muted'
                        : 'text-faint',
                  )}
                >
                  {active ? '当前' : provider.connected ? '已连接' : provider.configured ? '未连接' : '需配置'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {id === 'onedrive' || id === 'google-drive' ? (
                  provider.connected ? (
                    <>
                      {!active && (
                        <Button size="sm" variant="secondary" onClick={() => void setActive(id)}>
                          设为当前
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Unlink size={13} />}
                        loading={disconnecting}
                        onClick={() => setDisconnectTarget(id)}
                      >
                        断开
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Link2 size={13} />}
                      loading={connecting}
                      disabled={!provider.configured}
                      onClick={() => void connect(id)}
                    >
                      连接
                    </Button>
                  )
                ) : id === 'webdav' ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setWebdavOpen(true)}>
                      {provider.connected ? '编辑配置' : '配置'}
                    </Button>
                    {provider.connected && !active && (
                      <Button size="sm" variant="ghost" onClick={() => void setActive(id)}>
                        设为当前
                      </Button>
                    )}
                    {provider.connected && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Unlink size={13} />}
                        loading={disconnecting}
                        onClick={() => setDisconnectTarget(id)}
                      >
                        断开
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setS3Open(true)}>
                      {provider.connected ? '编辑配置' : '配置'}
                    </Button>
                    {provider.connected && !active && (
                      <Button size="sm" variant="ghost" onClick={() => void setActive(id)}>
                        设为当前
                      </Button>
                    )}
                    {provider.connected && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Unlink size={13} />}
                        loading={disconnecting}
                        onClick={() => setDisconnectTarget(id)}
                      >
                        断开
                      </Button>
                    )}
                  </>
                )}
              </div>
              {(id === 'onedrive' || id === 'google-drive') && !provider.configured && (
                <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
                  需要在 .env 填入 OAuth Client ID 并完成回调注册（见 docs/oauth-setup.md）。
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-[13px] font-semibold text-ink">自动备份</h3>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">
          浏览器打开期间定时检查；仅有改动时上传。关闭网页后不会在后台运行，云备份也不会反向覆盖本地。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={state.settings.autoBackup}
              onChange={(event) =>
                void backup.updateSettings({ autoBackup: event.target.checked })
              }
            />
            启用自动备份
          </label>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            间隔
            <select
              className="h-8 rounded-lg border border-line bg-surface px-2 text-[12px] text-ink"
              value={state.settings.intervalMinutes}
              onChange={(event) =>
                void backup.updateSettings({ intervalMinutes: Number(event.target.value) })
              }
            >
              {[15, 30, 60, 120, 360].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            保留
            <input
              type="number"
              min={1}
              max={50}
              value={state.settings.keepCount}
              onChange={(event) =>
                void backup.updateSettings({ keepCount: Number(event.target.value) || 10 })
              }
              className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-[12px] text-ink"
            />
            份
          </label>
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={state.settings.encryptionEnabled}
              onChange={(event) =>
                void backup.updateSettings({ encryptionEnabled: event.target.checked })
              }
            />
            <ShieldCheck size={14} className="text-muted" aria-hidden />
            加密云端备份（AES-256-GCM）
          </label>
          {state.settings.encryptionEnabled ? (
            <div className="mt-2 space-y-2">
              <p className="text-[11.5px] leading-relaxed text-faint">
                密码只用于本次会话的加密与恢复，不写入备份包、不写入磁盘；忘记密码无法恢复。自动备份需要先在本次会话记住密码。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  className={`${inputClass} h-8 w-56 text-[12px]`}
                  placeholder="本次会话备份密码（≥8 位）"
                  value={sessionPasswordDraft}
                  onChange={(event) => setSessionPasswordDraft(event.target.value)}
                  autoComplete="new-password"
                  aria-label="本次会话备份密码"
                />
                <Button size="sm" variant="secondary" onClick={saveSessionPassword}>
                  在本次会话记住
                </Button>
                {state.hasSessionPassword ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      backup.setSessionPassword(null)
                      toast('已清除本次会话密码')
                    }}
                  >
                    清除
                  </Button>
                ) : (
                  <span className="text-[11px] text-faint">尚未记住密码</span>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[11.5px] text-faint">
              关闭时备份包为明文 ZIP；如需保护云端内容，请开启加密。
            </p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-[13px] font-semibold text-ink">云端备份历史</h3>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-ink"
            onClick={() => void refreshHistory()}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} /> 刷新
          </button>
        </div>
        {!activeId ? (
          <p className="px-4 py-5 text-[12px] text-faint">选择并连接一个备份服务后，这里会列出云端快照。</p>
        ) : state.remoteHistory.length === 0 ? (
          <p className="px-4 py-5 text-[12px] text-faint">
            {state.error ? '无法读取云端列表，请检查连接。' : '云端还没有备份快照。'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {state.remoteHistory.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-ink">{item.name}</p>
                  <p className="text-[10.5px] text-faint">
                    {formatDateTime(item.modifiedAt)} · {formatBytes(item.size)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={restoringId === item.id}
                  onClick={() => {
                    setRestoringId(item.id)
                    void restore
                      .openRemote(item.id, item.name)
                      .finally(() => setRestoringId(null))
                  }}
                >
                  恢复
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <WebDavDialog open={webdavOpen} onClose={() => setWebdavOpen(false)} />
      <S3Dialog open={s3Open} onClose={() => setS3Open(false)} />

      <Dialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="输入加密备份密码"
        description="此密码仅用于本次加密与之后的恢复，不会写入磁盘。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPasswordOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busyAction === 'backup'}
              onClick={submitBackupPassword}
            >
              开始备份
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="备份密码" hint="至少 8 个字符；遗忘后无法恢复该备份。">
            <input
              type="password"
              className={inputClass}
              value={passwordDraft}
              onChange={(event) => setPasswordDraft(event.target.value)}
              autoFocus
              autoComplete="new-password"
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitBackupPassword()
              }}
            />
          </Field>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.target.checked)}
            />
            仅本次浏览会话内记住（不写入磁盘）
          </label>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(disconnectTarget)}
        onClose={() => setDisconnectTarget(null)}
        title="断开备份服务？"
        description="将删除保存在本机的授权/凭证。云端已有的备份文件不会被删除。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDisconnectTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (disconnectTarget) void disconnect(disconnectTarget)
              }}
            >
              断开
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-2 text-[12px] text-muted">
          <KeyRound size={14} className="mt-0.5 shrink-0" aria-hidden />
          重新连接需要再次完成授权或输入配置。备份历史仍可从其他设备恢复。
        </p>
      </Dialog>
    </div>
  )
}
