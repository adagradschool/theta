import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = new URL("../..", import.meta.url).pathname;

export default defineConfig({
	plugins: [react()],
	resolve: {
		dedupe: ["react", "react-dom"],
	},
	optimizeDeps: {
		exclude: ["@electric-sql/pglite", "@electric-sql/pglite/worker"],
	},
	worker: {
		format: "es",
	},
	server: {
		host: "127.0.0.1",
		port: 4180,
		strictPort: true,
		fs: {
			allow: [repoRoot],
		},
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
	preview: {
		host: "127.0.0.1",
		port: 4181,
		strictPort: true,
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
});
