import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const api = env.VITE_API_URL || "https://tigerhack-api.onrender.com";

  return {
    plugins: [react()],
    server: {
      host: "localhost",
      port: 5173,
      proxy: {
        "/api": {
          target: api,
          changeOrigin: true,
        },
      },
    },
  };
});
