// file: src/components/message-context/index.tsx

import {
	createContext,
	createEffect,
	useContext,
	type ParentProps,
} from 'solid-js';
import { isServer } from 'solid-js/web';

import { fromJson, type Message } from '~/lib/chat';

import { makeHistory } from './message-history';
import { KeepAlive } from './keep-alive';
import { Streamer } from './streamer';
import { Longpoller } from './longpoller';
import { makeCount } from './reference-count';

// import { scheduleCompare } from '~/lib/row-monitor';

// --- BEGIN server side ---

import server$, {
	ServerError,
	useRequest,
	type ServerFunctionEvent,
} from 'solid-start/server';

import {
	SSE_FALLBACK_SEARCH_PAIR,
	eventPoll,
	eventStream,
	requestInfo,
	type InitPoll,
	type InitSource,
} from '~/server/solid-start-sse-support';
// NOTE: call `listen()` in `entry-server.tsx`

import {
	fromFetchEventClientId,
	makeServerWelcome,
	longPoll,
	subscribe as subscribeToSource,
} from '~/server/pub-sub';

async function connectServerSource(this: ServerFunctionEvent) {
	const clientId = fromFetchEventClientId(this);
	const info = requestInfo(this.request);
	const args = {
		lastEventId: info.lastEventId,
		clientId,
	};

	// Use `if(info.streamed === undefined) {` to force error to switch to long polling fallback
	if (info.streamed) {
		let unregister: (() => void) | undefined = undefined;

		const init: InitSource = (controller) => {
			const result = subscribeToSource(controller, args);
			unregister = result.unregister;

			const cleanup = () => {
				if (unregister) {
					unregister();
					unregister = undefined;
				}
				console.log('source closed');
			};

			return {
				cleanup,
				headers: result.headers,
			};
		};

		return eventStream(this.request, init);
	}

	if (info.streamed === false) {
		const init: InitPoll = (controller) => {
			let close = longPoll(controller, args);
			if (!close) {
				console.log('poll closed');
				return undefined;
			}

			const cleanup = () => {
				if (close) {
					close();
					close = undefined;
				}
				console.log('poll closed');
			};

			// headers are passed via `controller.close`
			return cleanup;
		};

		return eventPoll(this.request, init);
	}

	throw new ServerError('Unsupported Media Type', { status: 415 });
}

function serverSideLoad() {
	const pageEvent = useRequest();
	const clientId = fromFetchEventClientId(pageEvent);
	const [message, headers] = makeServerWelcome(clientId);

	if (headers) {
		for (const [name, value] of Object.entries(headers))
			pageEvent.responseHeaders.append(name, value);
	}

	return message.kind === 'welcome' ? message : undefined;
}

// --- END server side ---

type TimerId = ReturnType<typeof setTimeout>;
const clearTimer = (id: TimerId) => clearTimeout(id);
const msSinceStart = () => Math.trunc(performance.now());

// --- Context value
const [historyStore, history] = makeHistory();
const MessageContext = createContext(historyStore);

// --- Keep alive timer
let start: () => void | undefined;
const keepAlive = new KeepAlive({
	actionMs: 20000, // 20 secs
	action: () => start?.(),
	timeMs: msSinceStart,
	schedule: (action, delay, core) => setTimeout(action, delay, core),
	clearTimer,
});
const stopKeepAlive = keepAlive.stop;

// --- BEGIN general connection

//  0 - No connection attempted
//  1 - EventSource created
//  2 - At least one message received via event source
//  3 - Use longpoll fallback (event source had error before reaching 2)
// -1 - Connection failed (fallback also encountered an error; perhaps
//      identifying the reason for the event source failure)
//
const STATUS_IDLE = 0;
const STATUS_WAITING = 1;
const STATUS_MESSAGE = 2;
const STATUS_LONG_POLL = 3;
const STATUS_FAILED = -1;
let connectStatus = STATUS_IDLE;
let lastEventId: string | undefined;

function toHref(basePath: string, eventId?: string, useSse = true) {
	const lastEvent = eventId
		? 'lastEventId=' + encodeURIComponent(eventId)
		: undefined;
	const query = useSse
		? lastEvent
		: lastEvent
		? SSE_FALLBACK_SEARCH_PAIR + '&' + lastEvent
		: SSE_FALLBACK_SEARCH_PAIR;

	return query ? basePath + '?' + query : basePath;
}

function update(message: Message) {
	switch (message.kind) {
		case 'chat': {
			history.shunt(message.messages);
			// scheduleCompare();
			console.log('chat', message.timestamp);
			break;
		}

		case 'welcome': {
			history.reset(message);
			// scheduleCompare();
			console.log('welcome', message.timestamp);
			break;
		}

		case 'keep-alive': {
			console.log('keep-alive', message.timestamp);
			break;
		}
	}
}

// --- BEGIN event source
// keepAlive terminates a stream which hasn't received a message

const streamer = new Streamer({
	stopKeepAlive,
	streamWaiting: () => {
		connectStatus = STATUS_WAITING;
		keepAlive.start();
	},
	streamFailed: () => {
		connectStatus = STATUS_LONG_POLL;
		setTimeout(start);
	},
	handleMessageData: (data: string, eventId: string | undefined) => {
		keepAlive.start();
		if (eventId) lastEventId = eventId;

		const message = fromJson(data);
		if (!message) return;

		connectStatus = STATUS_MESSAGE;
		update(message);
	},
});

// --- BEGIN long polling
// keepAlive will abort/retry a fetch that is taking too long

function prepareMessageFetch(basepath: string) {
	const abort = new AbortController();
	const fn = async () => {
		let result = false;

		try {
			const href = toHref(basepath, lastEventId, false);
			keepAlive.start();
			const response = await fetch(href, { signal: abort.signal });
			keepAlive.stop();

			if (response.ok) {
				const message = fromJson(await response.text());
				if (message) {
					lastEventId = String(message.timestamp);
					update(message);
					result = true;
				}
			}
		} catch (error) {
			keepAlive.stop();
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				// Wasn't aborted (by keepAlive)
				throw error;
			}
		}
		return result;
	};
	fn.abort = () => abort.abort();

	return fn;
}

const polling = new Longpoller({
	betweenMs: 50,
	backoffMs: 10000,
	schedule: (fetchPoll, delayMs, core) => setTimeout(fetchPoll, delayMs, core),
	prepareMessageFetch,
	pollFailed: () => void (connectStatus = STATUS_FAILED),
	clearTimer,
	stopKeepAlive,
});

// --- BEGIN Context Provider/Hook

const [referenceCount, references] = makeCount();
const disposeMessages = references.decrement;

const isActive = () => streamer.active || polling.active;

function disconnect() {
	if (streamer.active) streamer.disconnect();
	else polling.disconnect();
}

function connect(basepath: string) {
	if (referenceCount() < 1) return;

	if (connectStatus !== STATUS_LONG_POLL)
		streamer.connect(toHref(basepath, lastEventId));
	else polling.connect(basepath);
}

function setupMessageConnection(basepath: string) {
	start = () => {
		disconnect();
		connect(basepath);
	};

	createEffect(() => {
		const count = referenceCount();

		if (count < 1) {
			if (isActive()) {
				disconnect();
			}
			return;
		}

		if (count > 0) {
			if (isActive()) return;

			start();
			return;
		}
	});
}

function MessageProvider(props: ParentProps) {
	if (isServer) {
		const message = serverSideLoad();
		if (message) history.reset(message);
	} else {
		const stream = server$(connectServerSource);
		setupMessageConnection(stream.url);
	}

	return (
		<MessageContext.Provider value={historyStore}>
			{props.children}
		</MessageContext.Provider>
	);
}

function useMessages() {
	references.increment();
	return useContext(MessageContext);
}

export { MessageProvider, disposeMessages, useMessages };
