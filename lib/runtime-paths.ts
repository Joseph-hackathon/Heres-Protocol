import path from 'path'

function isServerlessRuntime(): boolean {
  return (
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME != null ||
    process.cwd().startsWith('/var/task')
  )
}

export function getDataDir(): string {
  if (isServerlessRuntime()) {
    return path.join(process.env.TMPDIR || '/tmp', 'heres')
  }
  return path.join(process.cwd(), '.data')
}

export function getDataFilePath(filename: string): string {
  return path.join(getDataDir(), filename)
}
