export function verifyUniqueMigrationVersions(phase, filenames) {
  const versions = new Map()
  for (const filename of filenames) {
    const version = filename.slice(0, 3)
    const entries = versions.get(version) ?? []
    entries.push(filename)
    versions.set(version, entries)
  }

  for (const [version, entries] of versions) {
    if (entries.length !== 1) {
      throw new Error(
        `${phase} migration version ${version} is not unique: ${entries.join(', ')}`,
      )
    }
  }
}

export function verifyAppendOnlyMigrations(phase, appliedMigrations, repositoryMigrations) {
  const appliedVersions = [...appliedMigrations.keys()].map(filename => filename.slice(0, 3))
  const highestAppliedVersion = appliedVersions.sort().at(-1)
  if (!highestAppliedVersion) return

  for (const filename of repositoryMigrations.keys()) {
    if (
      !appliedMigrations.has(filename)
      && filename.slice(0, 3) <= highestAppliedVersion
    ) {
      throw new Error(
        `Pending ${phase} migration ${filename} is not newer than applied version ${highestAppliedVersion}; migration histories are append-only`,
      )
    }
  }
}
