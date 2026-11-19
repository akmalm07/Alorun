import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  { ignores: [".plasmo/**", "build/**", "test-results/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.mjs", "tests/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, chrome: "readonly" },
    },
  },
];
