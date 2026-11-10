import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Cloud, Database, Info, Palette } from 'lucide-react'
import { useThemeStore, type ThemePref } from '@/shared/theme'
import { IconButton, SegmentedControl } from '@/shared/ui'
import { BackupPanel } from '@/features/backup/ui/BackupPanel'
import { DataPanel } from '@/features/backup/ui/DataPanel'
import { RestoreProvider } from '@/features/backup/ui/restore'

export function SettingsPage() {
  const navigate = useNavigate()
  const pref = useThemeStore((state) => state.pref)
  const setPref = useThemeStore((state) => state.setPref)

  return (
    <RestoreProvider>
      <div className="h-full overflow-y-auto bg-canvas">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line bg-canvas/95 px-3 backdrop-blur">
          <IconButton label="返回草稿" onClick={() => navigate('/')}>
            <ArrowLeft size={17} />
          </IconButton>
          <h1 className="text-[14px] font-semibold">设置</h1>
          <span className="ml-auto text-[11px] text-faint">本地优先 · BYOS 备份</span>
        </header>

        <main className="mx-auto w-full max-w-[760px] space-y-10 px-5 py-8 md:px-8 md:py-10">
          <section aria-labelledby="appearance-heading">
            <h2
              id="appearance-heading"
              className="flex items-center gap-2 text-[13px] font-semibold text-ink"
            >
              <Palette size={15} className="text-muted" aria-hidden />
              外观
            </h2>
            <p className="mt-1 text-[12px] text-muted">
              主题保存在本机；选择“跟随系统”时会自动切换。
            </p>
            <div className="mt-3">
              <SegmentedControl<ThemePref>
                ariaLabel="主题"
                value={pref}
                onChange={setPref}
                options={[
                  { value: 'light', label: '浅色' },
                  { value: 'dark', label: '深色' },
                  { value: 'system', label: '跟随系统' },
                ]}
              />
            </div>
          </section>

          <section aria-labelledby="backup-heading">
            <h2
              id="backup-heading"
              className="flex items-center gap-2 text-[13px] font-semibold text-ink"
            >
              <Cloud size={15} className="text-muted" aria-hidden />
              云备份（BYOS）
            </h2>
            <p className="mb-3 mt-1 text-[12px] leading-relaxed text-muted">
              使用你自己的云存储保存不可变快照。云端不是主数据源；自动备份只读取本地数据，恢复必须由你明确确认。
            </p>
            <BackupPanel />
          </section>

          <section aria-labelledby="data-heading">
            <h2
              id="data-heading"
              className="flex items-center gap-2 text-[13px] font-semibold text-ink"
            >
              <Database size={15} className="text-muted" aria-hidden />
              数据与恢复
            </h2>
            <p className="mb-3 mt-1 text-[12px] leading-relaxed text-muted">
              本地 IndexedDB 是唯一权威数据源。更换域名、清除站点数据或更换浏览器前，请导出备份。
            </p>
            <DataPanel />
          </section>

          <section aria-labelledby="about-heading" className="pb-6">
            <h2
              id="about-heading"
              className="flex items-center gap-2 text-[13px] font-semibold text-ink"
            >
              <Info size={15} className="text-muted" aria-hidden />
              关于
            </h2>
            <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted">
              <p>Scratch · Duskbit Studio · v0.1.0</p>
              <p>
                纸张负责线性记录，画布负责空间整理，内容只有一份。云备份凭证保存在本浏览器中，不会写入任何备份包或日志。
              </p>
              <p className="text-faint">
                加密备份使用 Web Crypto（PBKDF2-SHA-256 310,000 次迭代 + AES-256-GCM）。密码遗失无法恢复。
              </p>
            </div>
          </section>
        </main>
      </div>
    </RestoreProvider>
  )
}
