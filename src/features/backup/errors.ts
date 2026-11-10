export type BackupErrorCode =
  | 'not-configured'
  | 'auth'
  | 'wrong-password'
  | 'password-required'
  | 'invalid-format'
  | 'unsupported-version'
  | 'too-large'
  | 'invalid-data'
  | 'cors'
  | 'not-found'
  | 'network'
  | 'unknown'

export class BackupError extends Error {
  constructor(
    public readonly code: BackupErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'BackupError'
  }
}

export function isBackupError(error: unknown): error is BackupError {
  return error instanceof BackupError
}

export function errorMessage(error: unknown): string {
  if (error instanceof BackupError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}
