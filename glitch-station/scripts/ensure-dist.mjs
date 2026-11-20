// wrangler dev needs the assets folder to exist even when Vite serves the
// client in development. Creates a placeholder page if no build exists yet.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "client", "dist");
if (!existsSync(join(dist, "index.html"))) {
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><title>Glitch Station</title><p>Dev mode: open the Vite address (port 5173), or run npm run build.</p>",
  );
}
