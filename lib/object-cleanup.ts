interface ObjectCleanupFailure {
  key: string
  error: unknown
}

export async function deleteRecordThenObjects(
  keys: string[],
  deleteRecord: () => Promise<unknown>,
  removeObject: (key: string) => Promise<unknown>,
) {
  await deleteRecord()

  const failures: ObjectCleanupFailure[] = []
  for (const key of keys) {
    try {
      await removeObject(key)
    } catch (error) {
      failures.push({ key, error })
    }
  }
  return failures
}
