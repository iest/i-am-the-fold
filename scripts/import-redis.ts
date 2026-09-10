import { backupRedis, BackupError, readBackup, restoreBackup } from "./backup";

async function main() {
  const [source, confirmation, ...extra] = process.argv.slice(2);
  if (!source || confirmation !== "--replace" || extra.length)
    throw new BackupError(
      "Usage: npm run redis:import -- /path/backup.json --replace (credentials in environment)",
    );
  const backup = await readBackup(source);
  const redis = backupRedis();
  try {
    await restoreBackup(redis, backup);
  } finally {
    redis.close?.();
  }
  console.log(
    `Restored ${Object.keys(backup.data.folds).length} fold heights. Existing visitor and challenge locks retain their expiry.`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof BackupError
      ? error.message
      : "Import failed; check the backup, Redis configuration and connectivity before retrying.",
  );
  process.exitCode = 1;
});
