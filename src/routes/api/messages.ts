// file: src/api/messages.ts
import {
	makeEventStream,
	type SourceController,
} from '../../server/event-stream';
import {
	makeEventPoll,
	type PollController,
} from '../../server/event-poll';
import { longpoll, subscribe } from '../../server/sub';
import { LONGPOLL_PAIR as byLongpoll } from '../../server/api';

import type { APIEvent } from '@solidjs/start/server';

function toPollResponse(data: string | null) {
	const [body, options] =
		data === null
			? [
					null,
					{
						status: 499,
						statusText: 'Client Close Request',
					},
				]
			: [
					data,
					{
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					},
				];
	return new Response(body, options);
}

export function GET(event: APIEvent) {
	const clientId = event.locals.clientId;
	const url = new URL(event.request.url);
	const eventIdFromUrl = url.searchParams.get('lastEventId') ?? undefined;

	if (!url.searchParams.has(byLongpoll[0], byLongpoll[1])) {
		// Check if there is a header from a agent level reconnect attempt
		// which is given precedence
		const eventIdFromHeader = event.request.headers.get('Last-Event-ID') ?? undefined;
		const lastEventId = eventIdFromHeader ? eventIdFromHeader : eventIdFromUrl;

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
	} // end-if not long poll

	console.log('LONG POLL');
	// long polling response
	const init = (controller: PollController) => {
		// Pass data control to the pub-sub poll waiter
		let unsubscribe: undefined | (() => void) = longpoll(controller, {
			clientId,
			lastEventId: eventIdFromUrl,
		});

		// `cleanup` is called if the client closes the Request
		return function cleanup() {
			if (unsubscribe) {
				unsubscribe();
				unsubscribe = undefined;
			}
			console.log(`poll closed ${clientId}`);
		};
	};

	return makeEventPoll(
		event.nativeEvent.node.req,
		init,
	).then(toPollResponse);
}
