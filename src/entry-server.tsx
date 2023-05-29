// file: src/entry-server.tsx

import {
	createHandler,
	renderAsync,
	StartServer,
	type MiddlewareInput,
	type MiddlewareFn,
} from 'solid-start/entry-server';

import { CLIENT_ID_NAME, fromRequestClientId } from '~/server/pub-sub';

// solid-start-sse-support
import { listen } from '~/server/solid-start-sse-support';

// solid-start-sse-support
listen();

function clientIdMiddleware({ forward }: MiddlewareInput) {
	const handler: MiddlewareFn = (event) => {
		// Attach user to FetchEvent if available
		const clientId = fromRequestClientId(event.request);
		if (clientId) event.locals[CLIENT_ID_NAME] = clientId;

		return forward(event);
	};

	return handler;
}

export default createHandler(
	clientIdMiddleware,
	renderAsync((event) => <StartServer event={event} />)
);
