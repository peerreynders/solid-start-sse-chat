// file: src/server/solid-start-sse-support
import { nanoid } from 'nanoid';

// WARNING: this deals with node requests
import type http from 'node:http';

// track closed requests

let lastPurge = performance.now();
const closedIds = new Map<string, number>();

function purgeClosedIds(now: number) {
	const cutOff = now - 120_000; // 2 minutes
	if (lastPurge > cutOff) return;

	for (const [id, time] of closedIds) if (time < cutOff) closedIds.delete(id);

	lastPurge = now;
}

function addClosedId(id: string) {
	const now = performance.now();
	purgeClosedIds(now);
	closedIds.set(id, now);
}

// manage request close subscriptions

const REQUEST_CLOSE = {
	source: 'request',
	name: 'close',
} as const;

type Info = typeof REQUEST_CLOSE;
type Notify = (n: Info) => void;

const subscribers = new Map<string, Set<Notify>>();

function removeSubscriber(id: string, notify: Notify) {
	const all = subscribers.get(id);
	if (!all) return false;

	const result = all.delete(notify);
	if (all.size < 1) subscribers.delete(id);

	return result;
}

function addSubscriber(id: string, notify: Notify) {
	const remove = () => removeSubscriber(id, notify);
	const found = subscribers.get(id);

	if (found) found.add(notify);
	else subscribers.set(id, new Set<Notify>().add(notify));

	return remove;
}

function notifySubscribers(id: string, info: Info) {
	const all = subscribers.get(id);
	if (!all) return;

	for (const notify of all) notify(info);

	if (info.name === 'close') {
		subscribers.delete(id);
		addClosedId(id);
	}
}

// Server-sent events long poll management
const SSE_CORRELATE = 'x-solid-start-sse-support';
const SSE_FALLBACK = 'x-solid-start-sse-long-poll';
const SSE_FALLBACK_SEARCH_PAIR = 'sseLongPoll=1';
const SSE_LAST_EVENT_ID = 'last-event-id';
const channel = process.env.NODE_ENV?.startsWith('dev')
	? new BroadcastChannel('solid-start-sse-support')
	: undefined;

type EventInfo = {
	id: string;
	info: Info;
};

function requestInfo(request: Request) {
	const lastEventId =
		request.headers.get(SSE_LAST_EVENT_ID) ??
		new URL(request.url).searchParams.get('lastEventId') ??
		undefined;
	return {
		streamed: request.headers.has(SSE_CORRELATE)
			? true
			: request.headers.has(SSE_FALLBACK)
			? false
			: undefined,
		lastEventId,
	};
}

const combineHeaders = (
	base: Record<string, string>,
	others?: Record<string, string>
) => (others ? Object.assign(base, others) : base);

let receive: (event: MessageEvent<EventInfo>) => void | undefined;
let listening = false;

// Start listening as soon as possible
function listen() {
	if (channel && !receive) {
		receive = (event: MessageEvent<EventInfo>) =>
			notifySubscribers(event.data.id, event.data.info);

		channel.addEventListener('message', receive);
	}
	listening = true;
}

// "Notify me when this request closes"
function subscribe(request: Request, notify: Notify) {
	if (!listening)
		throw Error(
			'Call `listen()` at application start up to avoid missing events'
		);

	const id =
		request.headers.get(SSE_CORRELATE) || request.headers.get(SSE_FALLBACK);
	if (!id) return;
	if (closedIds.has(id)) return;

	return addSubscriber(id, notify);
}

// eventStream for EventSource

export type SourceController = {
	send: (data: string, id?: string) => void;
	close: () => void;
};

export type InitSource = (controller: SourceController) => {
	cleanup: () => void;
	headers: Record<string, string> | undefined;
};

// `eventStream()` only uses the `data` and optionally the `id` field.
// `event` and `retry` are also available but not used here.
//
// https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#fields
//
function eventStream(request: Request, init: InitSource) {
	let otherHeaders: Record<string, string> | undefined;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (data: string, id?: string) => {
				const payload = (id ? 'id:' + id + '\ndata:' : 'data:') + data + '\n\n';
				controller.enqueue(encoder.encode(payload));
			};

			let cleanup: (() => void) | undefined;
			let unsubscribe: (() => boolean) | undefined = undefined;

			const closeConnection = () => {
				if (!cleanup) return;
				cleanup();
				cleanup = undefined;
				unsubscribe?.();
				controller.close();
			};

			const result = init({ send, close: closeConnection });
			cleanup = result.cleanup;
			otherHeaders = result.headers;

			unsubscribe = subscribe(request, (info) => {
				if (info.source === 'request' && info.name === 'close') {
					closeConnection();
					return;
				}
			});

			if (!unsubscribe) {
				closeConnection();
				return;
			}
		},
	});

	return new Response(stream, {
		headers: combineHeaders(
			{ 'Content-Type': 'text/event-stream' },
			otherHeaders
		),
	});
}

// eventSample for long polling

export type PollController = {
	close: (data: string, otherHeaders?: Record<string, string>) => void;
	cancel: () => void;
};

export type InitPoll = (controller: PollController) => () => void;

function eventPoll(request: Request, init: InitPoll) {
	return new Promise<Response>((resolve) => {
		// pub-sub cleanup
		let cleanup: (() => void) | undefined;
		// request close subscription
		let unsubscribe: (() => boolean) | undefined = undefined;

		const closeConnection = (response?: Response) => {
			if (!cleanup) return;

			cleanup();
			cleanup = undefined;
			unsubscribe?.();
			resolve(
				response
					? response
					: new Response(null, {
							status: 499,
							statusText: 'Client Close Request',
					  })
			);
		};

		const cancel = () => closeConnection();
		const close = (
			json: string,
			otherHeaders: Record<string, string> | undefined
		) => {
			closeConnection(
				new Response(json, {
					headers: combineHeaders(
						{ 'Content-Type': 'application/json' },
						otherHeaders
					),
				})
			);
		};
		// pub-sub side cleanup
		cleanup = init({ close, cancel });

		// subscribe to request closing
		unsubscribe = subscribe(request, (info) => {
			if (info.source === 'request' && info.name === 'close') {
				cancel();
				return;
			}
		});

		// If request was already closed send an empty response
		if (!unsubscribe) {
			cancel();
			return;
		}
	});
}

// --- Middleware ---

function sendEvent(id: string, info: Info) {
	return !channel
		? notifySubscribers(id, info)
		: channel.postMessage({
				id,
				info,
		  });
}

type NextFunction = (err?: unknown) => void;

function solidStartSseSupport(
	request: http.IncomingMessage,
	_response: http.ServerResponse,
	next: NextFunction
) {
	if (request.method !== 'GET') return next();

	const accept = request.headers.accept;
	const href = request.url;
	const name =
		accept && 0 <= accept.indexOf('text/event-stream')
			? SSE_CORRELATE
			: href && 0 <= href.indexOf(SSE_FALLBACK_SEARCH_PAIR)
			? SSE_FALLBACK
			: undefined;
	if (!name) return next();

	// tag request with a unique header
	// which will get copied
	const id = nanoid();
	request.headers[name] = id;

	// send event when request closes
	const close = () => {
		request.removeListener('close', close);
		sendEvent(id, REQUEST_CLOSE);
	};
	request.addListener('close', close);

	return next();
}

// Want to protect middleware from tree shaking
declare global {
	// eslint-disable-next-line no-var
	var __no_tree_shaking: Record<string, unknown> | undefined;
}

if (globalThis.__no_tree_shaking) {
	globalThis.__no_tree_shaking.solidStartSseSupport = solidStartSseSupport;
} else {
	globalThis.__no_tree_shaking = { solidStartSseSupport };
}

export {
	SSE_FALLBACK_SEARCH_PAIR,
	eventPoll,
	eventStream,
	listen,
	requestInfo,
	solidStartSseSupport,
};
