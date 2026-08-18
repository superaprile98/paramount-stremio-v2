import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // P15: il codebase usa `any` per le risposte non tipizzate delle API
      // Paramount+ (client.ts, vod.ts, utils.ts, ...). La migrazione completa
      // a tipi runtime è un lavoro a parte: degradiamo a warning per non
      // bloccare build/lint, mantenendo visibili i punti da sistemare.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
