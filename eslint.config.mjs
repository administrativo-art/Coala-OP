import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const relaxedNextRules = {
  "@next/next/no-assign-module-variable": "warn",
  "react-hooks/immutability": "warn",
  "react-hooks/preserve-manual-memoization": "warn",
  "react-hooks/purity": "warn",
  "react-hooks/refs": "warn",
  "react-hooks/rules-of-hooks": "warn",
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/static-components": "warn",
  "react/no-unescaped-entities": "warn",
};

const relaxedTypeScriptRules = {
  "@typescript-eslint/no-empty-object-type": "warn",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-require-imports": "warn",
};

export default defineConfig([
  ...nextVitals.map((config) => config.name === "next"
    ? { ...config, rules: { ...config.rules, ...relaxedNextRules } }
    : config),
  ...nextTypescript.map((config) => config.name === "typescript-eslint/recommended"
    ? { ...config, rules: { ...config.rules, ...relaxedTypeScriptRules } }
    : config),
  {
    name: "coala/existing-debt-baseline",
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "prefer-const": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "functions/lib/**",
    "node_modules/**",
    "out/**",
    "output/**",
    "scratch/**",
    "tmp/**",
  ]),
]);
