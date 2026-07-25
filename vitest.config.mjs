import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    exclude: ["brothers-ad-vercel/**", "node_modules/**", ".next/**"]
  }
});
