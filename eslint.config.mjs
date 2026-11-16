import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "drizzle/**"] },
  ...tseslint.configs.recommended,
  {
    files: [
      "app/**/*.{ts,tsx}",
      "src/**/*.{ts,tsx}",
      "api/**/*.ts",
      "tests/*.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
