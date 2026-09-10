import { build as bundle } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function build() {
  await mkdir(resolve(root, "dist/public/assets"), { recursive: true });
  const browser = await bundle({
    absWorkingDir: root,
    entryPoints: {
      client: "client/index.ts",
      worker: "client/worker.ts",
      styles: "client/styles.css",
    },
    outdir: "dist/public/assets",
    entryNames: "[name]-[hash]",
    chunkNames: "[name]-[hash]",
    assetNames: "[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    metafile: true,
    loader: { ".woff2": "file", ".woff": "file" },
    plugins: [
      {
        name: "styles",
        setup(build) {
          build.onLoad({ filter: /client\/styles\.css$/ }, async ({ path }) => {
            const css = await readFile(path, "utf8");
            const result = await postcss([
              tailwind(resolve(root, "tailwind.config.js")),
              autoprefixer,
            ]).process(css, { from: path, map: false });
            return {
              contents: result.css,
              loader: "css",
              resolveDir: dirname(path),
            };
          });
        },
      },
    ],
  });
  const assets = {};
  for (const [path, info] of Object.entries(browser.metafile.outputs)) {
    const name = {
      "client/index.ts": "client",
      "client/worker.ts": "worker",
      "client/styles.css": "styles",
    }[info.entryPoint];
    if (name)
      assets[name] = "/" + relative("dist/public", path).split("\\").join("/");
  }
  if (Object.keys(assets).length !== 3)
    throw new Error("Missing browser build outputs");
  const favicon = await readFile(resolve(root, "client/favicon.svg"));
  const faviconHash = createHash("sha256").update(favicon).digest("hex").slice(0, 12);
  assets.favicon = `/assets/favicon-${faviconHash}.svg`;
  await writeFile(resolve(root, `dist/public${assets.favicon}`), favicon);
  await writeFile(
    resolve(root, "dist/assets.json"),
    JSON.stringify(assets, null, 2) + "\n",
  );
  await bundle({
    absWorkingDir: root,
    entryPoints: ["server/index.ts"],
    outfile: "dist/server.mjs",
    platform: "node",
    target: "node24",
    format: "esm",
    bundle: true,
    packages: "external",
  });
  console.log("Built server and browser assets");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await build();
