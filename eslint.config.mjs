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
      "@next/next/no-assign-module-variable": "warn",
      "prefer-const": "warn",
    },
  },
  {
    name: "coala/design-no-native-dialogs",
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // docs/design/feedback.md: erro junto do campo e confirmação inline, nunca alert()/confirm().
      "no-restricted-globals": ["error", "alert", "confirm"],
    },
  },
  {
    name: "coala/design-no-loose-hex",
    files: ["src/**/*.tsx"],
    rules: {
      // docs/design/README.md: use tokens (bg-ds-*, text-ds-*), não hex solto em className.
      // `warn` porque o código anterior ao guia ainda tem hex; novas telas devem zerar o aviso.
      "no-restricted-syntax": [
        "warn",
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/\\[#[0-9a-fA-F]{3,8}\\]/]",
          message: "Hex solto em className. Use os tokens do guia de design (docs/design/tokens.md).",
        },
        {
          selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/\\[#[0-9a-fA-F]{3,8}\\]/]",
          message: "Hex solto em className. Use os tokens do guia de design (docs/design/tokens.md).",
        },
      ],
    },
  },
  {
    name: "coala/design-guide-no-loose-hex",
    files: [
      "src/components/patterns/**/*.{ts,tsx}",
      "src/components/design/**/*.{ts,tsx}",
      "src/components/ui/status-pill.tsx",
    ],
    rules: {
      // O guia novo é estrito sem exigir a migração dos milhares de hex legados.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Hex solto no guia de design. Use um token --ds-* ou uma variante semântica.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Hex solto no guia de design. Use um token --ds-* ou uma variante semântica.",
        },
      ],
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
