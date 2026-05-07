import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        Buffer: "readonly",
        console: "readonly",
        CustomEvent: "readonly",
        document: "readonly",
        Event: "readonly",
        GeolocationPosition: "readonly",
        HTMLDivElement: "readonly",
        HTMLElement: "readonly",
        Intl: "readonly",
        localStorage: "readonly",
        Map: "readonly",
        navigator: "readonly",
        requestAnimationFrame: "readonly",
        ResizeObserver: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        window: "readonly",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
