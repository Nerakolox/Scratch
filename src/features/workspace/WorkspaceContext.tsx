import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { DocumentService, type ServiceState } from '@/storage/document-service'
import { ScratchRepository } from '@/storage/repository'
import { getDb } from '@/storage/db'
import { BackupService, type BackupState } from '@/features/backup/backup-service'
import { Spinner } from '@/shared/ui'

const ServiceContext = createContext<DocumentService | null>(null)
const BackupContext = createContext<BackupService | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const repository = useMemo(() => new ScratchRepository(getDb()), [])
  const [service] = useState(() => new DocumentService(repository))
  const [backupService] = useState(() => new BackupService(repository, service))
  const [state, setState] = useState<ServiceState>(() => service.getState())
  const [bootError, setBootError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = service.subscribe(setState)
    service
      .init()
      .then(() => backupService.init())
      .catch((error: unknown) => {
        setBootError(error instanceof Error ? error.message : '无法打开本地数据库')
      })

    const flush = () => {
      if (document.visibilityState === 'hidden') void service.flush()
    }
    const pageHide = () => {
      void service.flush()
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', pageHide)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', pageHide)
      backupService.dispose()
      service.dispose()
    }
  }, [service, backupService])

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-6">
        <div className="max-w-sm rounded-xl border border-line bg-surface p-6 text-center">
          <h1 className="text-[15px] font-semibold">无法启动 Scratch</h1>
          <p className="mt-2 text-[13px] text-muted">
            本地数据库打开失败：{bootError}。请检查浏览器是否允许本站使用 IndexedDB，或尝试无痕模式以外的窗口。
          </p>
        </div>
      </div>
    )
  }

  if (!state.ready) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Spinner label="正在打开本地草稿…" />
      </div>
    )
  }

  return (
    <ServiceContext.Provider value={service}>
      <BackupContext.Provider value={backupService}>{children}</BackupContext.Provider>
    </ServiceContext.Provider>
  )
}

export function useDocumentService(): DocumentService {
  const service = useContext(ServiceContext)
  if (!service) throw new Error('useDocumentService must be used inside WorkspaceProvider')
  return service
}

export function useBackupService(): BackupService {
  const service = useContext(BackupContext)
  if (!service) throw new Error('useBackupService must be used inside WorkspaceProvider')
  return service
}

export function useServiceState(): ServiceState {
  const service = useDocumentService()
  const [state, setState] = useState<ServiceState>(() => service.getState())
  useEffect(() => service.subscribe(setState), [service])
  return state
}

export function useBackupState(): BackupState {
  const service = useBackupService()
  const [state, setState] = useState<BackupState>(() => service.getState())
  useEffect(() => service.subscribe(setState), [service])
  return state
}
