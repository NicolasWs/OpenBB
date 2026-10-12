import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/", "node_modules/", "public/", "src/generated/", "**/*.js", "**/*.cjs", "**/*.mjs", "**/*.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Headers: "readonly",
        Response: "readonly",
        fetch: "readonly",
        btoa: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        process: "readonly",
        Office: "readonly",
        OfficeRuntime: "readonly",
        CustomFunctions: "readonly",
        Excel: "readonly",
      },
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
