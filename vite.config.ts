import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tanstackStart(),
    nitro({ preset: "vercel" }),
    viteReact(),
    tailwindcss(),
    tsConfigPaths(),
  ],
  // recharts@2.x has internal circular-dependency issues that cause
  // "Cannot access 'X' before initialization" TDZ crashes when Vite
  // bundles it into the same chunk as the consumer. Splitting recharts
  // into its own chunk ensures it fully initialises before any consumer
  // code runs.
  //
  // We use the function form of manualChunks so that Nitro's SSR build
  // (which marks recharts as external) silently ignores it — the function
  // only fires for modules that are actually being bundled.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/recharts/") || id.includes("\\recharts\\")) {
            return "recharts";
          }
        },
      },
    },
  },
});
