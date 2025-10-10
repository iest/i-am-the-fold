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

async function exportRedisData() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("❌ Missing required arguments\n");
    console.error("Usage:");
    console.error("  npx tsx scripts/export-redis.ts <REDIS_URL> <REDIS_TOKEN>");
    console.error("  OR");
    console.error("  npm run redis:export -- <REDIS_URL> <REDIS_TOKEN>");
    console.error("\nExample:");
    console.error("  npx tsx scripts/export-redis.ts https://xxx.upstash.io YOUR_TOKEN");
    console.error("\nNote: When using npm run, arguments must come after --");
    process.exit(1);
  }

  const [url, token] = args;

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
    console.log("🔗 Connecting to Redis...");
    const redis = new Redis({ url: restUrl, token });

    // Test connection
    await redis.ping();
    console.log("✅ Connected successfully");

    // Fetch folds data
    console.log("📊 Fetching folds data...");
    const folds = await redis.hgetall("folds") as Record<string, number> || {};
    const foldsCount = Object.keys(folds).length;
    console.log(`  Found ${foldsCount} fold positions`);

    // Fetch IP keys with TTL
    console.log("🔍 Scanning for IP keys...");
    const ipKeys: Array<{ key: string; ttl: number }> = [];
    const foundKeys = new Set<string>();

    // Method 1: Try KEYS command first (more reliable with Upstash)
    try {
      console.log("  Attempting KEYS command...");
      const allKeys = await redis.keys("ip:*");

      if (Array.isArray(allKeys) && allKeys.length > 0) {
        console.log(`  KEYS found ${allKeys.length} potential IP keys`);

        // Get TTL for each key in batches
        for (let i = 0; i < allKeys.length; i += 20) {
          const batch = allKeys.slice(i, i + 20);
          const ttlPromises = batch.map(key => redis.ttl(key));
          const ttls = await Promise.all(ttlPromises);

          batch.forEach((key, idx) => {
            if (ttls[idx] > 0 && !foundKeys.has(key)) {
              foundKeys.add(key);
              ipKeys.push({ key, ttl: ttls[idx] });
            }
          });

          // Progress for large datasets
          if ((i + 20) % 100 === 0) {
            console.log(`    Processed ${Math.min(i + 20, allKeys.length)}/${allKeys.length} keys...`);
          }
        }
      }
    } catch (keysError) {
      console.log(`  KEYS command failed: ${keysError}`);

      // Method 2: Fallback to SCAN with aggressive settings
      console.log("  Falling back to SCAN...");
      let cursor = "0";
      let scanCount = 0;
      const maxScans = 1000;

      do {
        try {
          // Use higher count for better coverage
          const result = await redis.scan(cursor, { match: "ip:*", count: 1000 });
          cursor = String(result[0]);
          const keys = result[1] as string[];

          // Get TTL for each key
          for (const key of keys) {
            if (!foundKeys.has(key)) {
              const ttl = await redis.ttl(key);
              if (ttl > 0) {
                foundKeys.add(key);
                ipKeys.push({ key, ttl });
              }
            }
          }

          scanCount++;
          if (scanCount >= maxScans) {
            console.log(`  Warning: Reached scan limit of ${maxScans}`);
            break;
          }

          // Sometimes Upstash returns "0" even when there are more keys
          // Try a few more times even after getting "0"
          if (cursor === "0" && scanCount < 5) {
            cursor = String(Math.floor(Math.random() * 1000000));
          }
        } catch (scanError) {
          console.log(`  Scan error: ${scanError}`);
          break;
        }
      } while (cursor !== "0" || scanCount < 5);
    }

    console.log(`  Found ${ipKeys.length} IP keys with valid TTL`);

    // Create backup object
    const backup: BackupData = {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      data: {
        folds,
        ips: ipKeys
      }
    };

    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `redis-backup-${timestamp}.json`;
    const filepath = path.join(process.cwd(), filename);

    await fs.writeFile(filepath, JSON.stringify(backup, null, 2));
    console.log(`\n✅ Backup saved to: ${filename}`);

    // Summary
    console.log("\n📋 Backup Summary:");
    console.log(`  - Fold positions: ${foldsCount}`);
    console.log(`  - IP records: ${ipKeys.length}`);
    console.log(`  - Total size: ${(JSON.stringify(backup).length / 1024).toFixed(2)} KB`);

  } catch (error) {
    console.error("❌ Error during export:", error);
    process.exit(1);
  }
}

// Run the export
exportRedisData();