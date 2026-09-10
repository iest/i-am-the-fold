import { backupRedis, BackupError, parseBackup, writeBackup } from "./backup";

async function main() {
  const [destination, ...extra] = process.argv.slice(2);
  if (!destination || extra.length)
    throw new BackupError(
      "Usage: npm run redis:export -- /absolute/path/outside/project/backup.json (credentials in environment)",
    );
  const redis = backupRedis();
  try {
    const folds = (await redis.hgetall("folds")) || {};
    const backup = parseBackup({
      version: "2.0.0",
      timestamp: new Date().toISOString(),
      data: { folds },
    });
    await writeBackup(destination, backup);
    console.log(
      `Exported ${Object.keys(backup.data.folds).length} fold heights. No IP records were exported.`,
    );
  } finally {
    redis.close?.();
  }
}
main().catch((error) => {
  console.error(
    error instanceof BackupError
      ? error.message
      : "Export failed; check the output path, Redis configuration and connectivity.",
  );
  process.exitCode = 1;
});
