import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Eigenständige Node-Skripte im Hauptordner (create-user.js, auskunft.js, …): CommonJS, laufen per `node <skript>`
  // ohne Build - require() ist dort richtig. "*.js" trifft nur den Hauptordner und deckt jedes neue Skript dort ohne
  // eigenen Eintrag ab; gelintet werden sie trotzdem (Regel in suite-kit docs/KONVENTIONEN.md).
  { files: ["*.js"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "test-results/**",
    "playwright-report/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
