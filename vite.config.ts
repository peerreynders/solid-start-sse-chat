// file: vite.config.ts

import solid from "solid-start/vite";
import { defineConfig } from "vite";
import solidStartSsePlugin from './src/server/solid-start-sse-plugin';

export default defineConfig(({ mode }) => ({
  plugins: [
		solidStartSsePlugin(),
		solid()
	],
	define: {
		'process.env.NODE_ENV': JSON.stringify(mode),
	}
}));
