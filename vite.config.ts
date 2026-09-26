import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import type { Plugin, UserConfig } from "vite";
import solid from "vite-plugin-solid";

const root = fileURLToPath(new URL(".", import.meta.url));

// Start fetching the catalog while the bundle downloads. The static build
// reads the exported manifest; the server build reads the CMS catalog.
function preloadCatalog(mode: string): Plugin {
  const href = mode === "static" ? "/media/archive.json" : "/api/site";
  return {
    name: "nolle-preload-catalog",
    transformIndexHtml: {
      order: "pre",
      handler: () => [{ tag: "link", attrs: { rel: "preload", href, as: "fetch", crossorigin: "anonymous" }, injectTo: "head" }],
    },
  };
}

export default defineConfig(({ mode, command }): UserConfig => {
  const env = loadEnv(mode, process.cwd(), "CMS_");
  const cms = { target: `http://127.0.0.1:${env.CMS_PORT || "8788"}`, changeOrigin: false };
  const build = { target: "es2023", cssTarget: ["chrome111", "safari16.4", "firefox128"], reportCompressedSize: false, modulePreload: { polyfill: false } };

  // The Content Room is a separate bundle that the CMS serves at /admin/.
  if (mode === "admin") {
    return {
      plugins: [solid()],
      root: `${root}admin`,
      base: "/admin/",
      publicDir: false,
      build: { ...build, outDir: `${root}dist-admin`, emptyOutDir: true },
    };
  }

  return {
    plugins: [solid(), command === "build" ? preloadCatalog(mode) : []],
    base: "/",
    build,
    // In development one Vite server hosts both the site (/) and the Content
    // Room (/admin/); the CMS answers the API and uploaded media.
    server: { host: "127.0.0.1", proxy: { "/api": cms, "/media/photos": cms, "/media/videos": cms } },
  };
});
