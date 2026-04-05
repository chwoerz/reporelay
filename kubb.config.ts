import { defineConfig } from "@kubb/core";
import { pluginOas } from "@kubb/plugin-oas";
import { pluginTs } from "@kubb/plugin-ts";
import { pluginZod } from "@kubb/plugin-zod";

export default defineConfig({
  root: ".",
  input: {
    path: "./openapi.yaml",
  },
  output: {
    path: "./src/generated",
    clean: true,
    extension: { ".ts": ".js" },
  },
  plugins: [
    pluginOas({ generators: [] }),
    pluginTs({
      output: {
        path: "./types",
      },
    }),
    pluginZod({
      output: {
        path: "./zod",
      },
    }),
  ],
});
