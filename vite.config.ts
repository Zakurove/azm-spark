import { createApi } from "./server/api";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), {name:"azm-api", configureServer(server:any){const api=createApi();server.middlewares.use(api.handle);server.httpServer?.once("close",api.close);}, configurePreviewServer(server:any){const api=createApi();server.middlewares.use(api.handle);server.httpServer?.once("close",api.close);}}],
  build: { target: "es2022" },
  // vitest
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
} as never);
