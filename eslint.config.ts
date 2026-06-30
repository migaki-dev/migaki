import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["coverage/**", "**/dist/**", "node_modules/**", ".pnpm-store/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
);
