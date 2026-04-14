import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

// Load .env for DB credentials etc.
dotenv.config();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
