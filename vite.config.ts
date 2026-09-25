import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "CMS_");
  const cms = `http://127.0.0.1:${env.CMS_PORT || "8788"}`;
  const proxy = { target: cms, changeOrigin: false };
  return {
    base: "/",
    plugins: [react()],
    server: {
      proxy: { "/api": proxy, "/admin": proxy, "/media/photos": proxy },
    },
  };
});
