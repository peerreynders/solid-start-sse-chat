// file: src/api/messages.ts
import {
	makeEventStream,
	type SourceController,
} from '../../server/event-stream';
import { subscribe } from '../../server/pub-sub';

import type { APIEvent } from '@solidjs/start/server';

export function GET(event: APIEvent) {
	const clientId = event.locals.clientId;
	const url = new URL(event.request.url);
	const lastEventId = url.searchParams.get('lastEventId') ?? undefined;

	const init = (controller: SourceController) => {
		// Pass data streaming control to the pub-sub Streamer
		let unsubscribe: undefined | (() => void) = subscribe(controller, {
			clientId,
			lastEventId,
		});

		// `cleanup` is called when the client closes the Response
		return function cleanup() {
			if (unsubscribe) {
				unsubscribe();
				unsubscribe = undefined;
			}
			console.log(`source closed ${clientId}`);
		};
	};

	return new Response(
		makeEventStream(
			event.nativeEvent.node.req,
			init
		) as ReadableStream<unknown>,
		{
			status: 200,
			headers: {
				'cache-control': 'no-cache',
				connection: 'keep-alive',
				'content-type': 'text/event-stream',
			},
		}
	);
}
