import { defineConfig } from "vitest/config";
import path from "node:path";

// P22: configurazione vitest con alias "@/*" allineato a tsconfig.json.
export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "."),
        },
    },
});