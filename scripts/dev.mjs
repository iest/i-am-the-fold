import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { build } from "./build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
let server;
let rebuilding = false;
let queued = false;
let timer;
let closing = false;

async function rebuild() {
  if (closing) return;
  if (rebuilding) { queued = true; return; }
  rebuilding = true;
  try {
    await build();
    if (server && server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    if (!closing) server = spawn(process.execPath, ["dist/server.mjs"], {
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "development" },
    });
  } catch (error) {
    console.error(error);
  } finally {
    rebuilding = false;
    if (queued) { queued = false; void rebuild(); }
  }
}
const watchers = ["server", "client", "util-client.ts", "util-server.ts", "tailwind.config.js"].map(path =>
  watch(path, { recursive: path === "server" || path === "client" }, (_event, filename) => {
    // File watchers can report sibling changes on some platforms. Ignore them,
    // especially generated output, to avoid rebuilding in response to a build.
    if (!filename || (path.includes(".") && String(filename) !== basename(path))) return;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 100);
  }),
);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  closing = true;
  clearTimeout(timer);
  watchers.forEach(watcher => watcher.close());
  server?.kill(signal);
});
await rebuild();
