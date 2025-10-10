import { Redis } from "@upstash/redis";
import fs from "fs/promises";
import path from "path";

interface BackupData {
  version: string;
  timestamp: string;
  data: {
    folds: Record<string, number>;
    ips: Array<{
      key: string;
      ttl: number;
    }>;
  };
}

async function importRedisData() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("❌ Missing required arguments\n");
    console.error("Usage:");
    console.error("  npx tsx scripts/import-redis.ts <REDIS_URL> <REDIS_TOKEN> <BACKUP_FILE>");
    console.error("  OR");
    console.error("  npm run redis:import -- <REDIS_URL> <REDIS_TOKEN> <BACKUP_FILE>");
    console.error("\nExample:");
    console.error("  npx tsx scripts/import-redis.ts https://xxx.upstash.io YOUR_TOKEN redis-backup-2024.json");
    console.error("\nNote: When using npm run, arguments must come after --");
    process.exit(1);
  }

  const [url, token, backupFile] = args;

  // Convert Redis protocol URL to REST API URL if needed
  let restUrl = url;
  if (url.includes(":6379")) {
    console.log("⚠️  Detected Redis protocol URL (port 6379)");
    console.log("   Converting to Upstash REST API URL...");

    // Remove port and convert to HTTPS
    restUrl = url
      .replace(":6379", "")
      .replace("http://", "https://")
      .replace("redis://", "https://");

    console.log(`   Using: ${restUrl}`);
  }

  // Validate URL format
  if (!restUrl.startsWith("https://") && !restUrl.startsWith("http://")) {
    console.error("❌ Invalid Redis URL format");
    console.error("\nUpstash provides two types of URLs:");
    console.error("1. REST API URL: https://xxx.upstash.io (use this)");
    console.error("2. Redis URL: redis://xxx.upstash.io:6379 (auto-converted)");
    console.error("\nGot:", url);
    console.error("\nIn Upstash console, look for 'REST API' section and use the UPSTASH_REDIS_REST_URL");
    process.exit(1);
  }

  try {
    // Read backup file
    console.log(`📂 Reading backup file: ${backupFile}`);
    const filepath = path.join(process.cwd(), backupFile);
    const fileContent = await fs.readFile(filepath, "utf-8");
    const backup: BackupData = JSON.parse(fileContent);

    console.log(`  Backup created: ${backup.timestamp}`);
    console.log(`  Version: ${backup.version}`);

    // Connect to Redis
    console.log("\n🔗 Connecting to Redis...");
    const redis = new Redis({ url: restUrl, token });

    // Test connection
    await redis.ping();
    console.log("✅ Connected successfully");

    // Ask for confirmation
    console.log("\n⚠️  WARNING: This will overwrite existing data!");
    console.log("  Backup contains:");
    console.log(`    - ${Object.keys(backup.data.folds).length} fold positions`);
    console.log(`    - ${backup.data.ips.length} IP records`);
    console.log("\n  Press Ctrl+C to abort, or wait 5 seconds to continue...");

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Clear existing data (optional - comment out if you want to merge instead)
    console.log("\n🗑️  Clearing existing data...");
    await redis.del("folds");

    // Clear existing IP keys
    const keysToDelete: string[] = [];

    // Try KEYS command first for reliability
    try {
      const allIpKeys = await redis.keys("ip:*");
      keysToDelete.push(...allIpKeys);
    } catch (err) {
      console.log(`  KEYS command failed, falling back to SCAN`);

      // Fallback to SCAN
      let cursor = "0";
      let scanCount = 0;
      const maxScans = 1000;

      do {
        try {
          const result = await redis.scan(cursor, { match: "ip:*", count: 1000 });
          cursor = String(result[0]);
          keysToDelete.push(...(result[1] as string[]));

          scanCount++;
          if (scanCount >= maxScans) {
            console.log(`  Warning: Reached scan limit, some IP keys may remain`);
            break;
          }
        } catch (scanError) {
          console.log(`  Scan error during cleanup: ${scanError}`);
          break;
        }
      } while (cursor !== "0");
    }

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
      console.log(`  Deleted ${keysToDelete.length} existing IP keys`);
    }

    // Import folds data
    console.log("\n📊 Importing folds data...");
    if (Object.keys(backup.data.folds).length > 0) {
      // Convert to the format hset expects
      const foldsData: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(backup.data.folds)) {
        foldsData[key] = value;
      }
      await redis.hset("folds", foldsData);
      console.log(`  ✅ Imported ${Object.keys(backup.data.folds).length} fold positions`);
    } else {
      console.log("  No folds data to import");
    }

    // Import IP keys with TTL
    console.log("\n🔍 Importing IP keys...");
    let importedIPs = 0;
    for (const ipData of backup.data.ips) {
      // Extract just the IP part from "ip:xxx.xxx.xxx.xxx"
      const ip = ipData.key.replace("ip:", "");

      // Set the key with TTL
      await redis.set(`ip:${ip}`, 1, { ex: ipData.ttl });
      importedIPs++;

      // Progress indicator for large datasets
      if (importedIPs % 100 === 0) {
        console.log(`  Imported ${importedIPs}/${backup.data.ips.length} IP keys...`);
      }
    }
    console.log(`  ✅ Imported ${importedIPs} IP keys`);

    // Verify import
    console.log("\n🔎 Verifying import...");
    const verifyFolds = await redis.hgetall("folds") as Record<string, number>;
    console.log(`  Folds in Redis: ${Object.keys(verifyFolds).length}`);

    // Try KEYS for accurate count
    let ipCount = 0;
    try {
      const allIpKeys = await redis.keys("ip:*");
      ipCount = allIpKeys.length;
    } catch (err) {
      // Fallback to scan if KEYS fails
      let cursor = "0";
      let scanCount = 0;
      const maxScans = 1000;

      do {
        try {
          const result = await redis.scan(cursor, { match: "ip:*", count: 1000 });
          cursor = String(result[0]);
          ipCount += (result[1] as string[]).length;

          scanCount++;
          if (scanCount >= maxScans) {
            console.log(`  (Verification incomplete - scan limit reached)`);
            break;
          }
        } catch (scanError) {
          console.log(`  Scan error during verification: ${scanError}`);
          break;
        }
      } while (cursor !== "0");
    }
    console.log(`  IP keys in Redis: ${ipCount}`);

    console.log("\n✅ Import completed successfully!");

  } catch (error) {
    console.error("❌ Error during import:", error);
    process.exit(1);
  }
}

// Run the import
importRedisData();