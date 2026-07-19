import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["node_modules/", "artifacts/", "public/generated/"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: { "@typescript-eslint/consistent-type-imports": "error" },
  },
);
