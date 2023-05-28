// file: src/server/solid-start-sse-plugin
import { solidStartSseSupport } from './solid-start-sse-support';

import type { ViteDevServer } from 'vite';

export default function solidStartSsePlugin() {
	return {
		name: 'solid-start-sse-support',
		configureServer(server: ViteDevServer) {
			// Pre-internal middleware here:
			server.middlewares.use(solidStartSseSupport);

			// Post internal middleware should be registered
			// in a returned thunk, e.g.:
			// return () => {
			//   server.middlewares.use(middleware);
			// };
			return;
		},
	};
}
