import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import { resolve } from "path";
import { copyFileSync, readFileSync } from "fs";

// Every dependency stays external so the host app provides one shared copy.
// A bundled second copy of yjs or prosemirror breaks collaboration and
// instanceof checks.
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
const externalPackages = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];
const isExternal = (id: string) =>
  externalPackages.some((name) => id === name || id.startsWith(`${name}/`));

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: [
        "src/lib/**/*",
        "src/extensions/**/*",
        "src/components/ai/**/*",
        "src/context/**/*",
      ],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      outDir: "dist",
      rollupTypes: true,
    }),
    {
      name: "copy-css",
      closeBundle() {
        // Copy the CSS file to dist after build
        copyFileSync(
          resolve(__dirname, "src/index.css"),
          resolve(__dirname, "dist/styles.css"),
        );
        console.log("✓ Copied styles.css to dist/");
      },
    },
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/lib/index.ts"),
      name: "DeditReactEditor",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: isExternal,
      output: {
        interop: "auto",
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "@tiptap/react": "TiptapReact",
          "@tiptap/core": "TiptapCore",
        },
      },
    },
    sourcemap: true,
    minify: false,
  },
});
