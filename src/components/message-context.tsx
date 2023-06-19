// file: src/components/message-context

import {
	createContext,
	createEffect,
	createSignal,
	useContext,
	type ParentProps,
} from 'solid-js';
import { isServer } from 'solid-js/web';
import { createStore } from 'solid-js/store';

import {
	fromJson,
	type ChatMessage,
	type Message,
	type Welcome,
} from '~/lib/chat';

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

// --- BEGIN Context value

const msSinceStart = () => Math.trunc(performance.now());
const historyPool: [ChatMessage[], ChatMessage[]] = [[], []];
let currentHistory = 0;
let lastMessageMs = msSinceStart();

function resetHistory(messages: ChatMessage[]) {
	const next = 1 - currentHistory;
	const source = historyPool[currentHistory];
	const target = historyPool[next];
	target.splice(0, Infinity, ...messages);
	source.length = 0;
	currentHistory = next;
	return target;
}

function shuntOnHistory(message?: ChatMessage[] | ChatMessage) {
	if (!message) return historyPool[currentHistory];

	const next = 1 - currentHistory;
	const source = historyPool[currentHistory];
	const target = historyPool[next];

	if (Array.isArray(message)) {
		for (let i = 0; i < message.length; i += 1) target[i] = message[i];
	} else {
		target[0] = message;
	}

	const offset = target.length;
	for (let i = 0; i < source.length; i += 1) target[i + offset] = source[i];

	source.length = 0;
	currentHistory = next;
	return target;
}

type ChatCore = {
	id: string | undefined;
	history: ChatMessage[];
};

function makeHolder() {
	const [store, set] = createStore<ChatCore>({
		id: undefined,
		history: shuntOnHistory(),
	});
	const shuntMessages = (recent: ChatMessage[] | ChatMessage) =>
		set('history', shuntOnHistory(recent));
	const reset = (message: Welcome) => {
		set({
			id: message.id,
			history: resetHistory(message.messages),
		});
	};

	return {
		context: store,
		shuntMessages,
		reset,
	};
}

const contextHolder = makeHolder();
const MessageContext = createContext(contextHolder.context);

function update(message: Message) {
	lastMessageMs = msSinceStart();

	switch (message.kind) {
		case 'chat': {
			contextHolder.shuntMessages(message.messages);
			// scheduleCompare();
			console.log('chat', message.timestamp);
			break;
		}

		case 'welcome': {
			contextHolder.reset(message);
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

// --- BEGIN Keep alive timer

const KEEP_ALIVE_MS = 20000;
let keepAliveTimeout: ReturnType<typeof setTimeout> | undefined;
let start: () => void | undefined;

function keepAlive() {
	const silence = msSinceStart() - lastMessageMs;
	const delay =
		silence < KEEP_ALIVE_MS ? KEEP_ALIVE_MS - silence : KEEP_ALIVE_MS;
	if (delay < KEEP_ALIVE_MS) {
		keepAliveTimeout = setTimeout(keepAlive, delay);
		return;
	}

	keepAliveTimeout = undefined;
	start?.();
}

function startKeepAlive() {
	if (keepAliveTimeout) return;

	lastMessageMs = msSinceStart();
	keepAliveTimeout = setTimeout(keepAlive, KEEP_ALIVE_MS);
}

function stopKeepAlive() {
	if (!keepAliveTimeout) return;

	clearTimeout(keepAliveTimeout);
	keepAliveTimeout = undefined;
}

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

// --- BEGIN event source

const READY_STATE_CLOSED = 2;
let eventSource: EventSource | undefined;

function onMessage(event: MessageEvent<string>) {
	lastMessageMs = msSinceStart();
	if (event.lastEventId) lastEventId = event.lastEventId;

	const message = fromJson(event.data);
	if (!message) return;

	connectStatus = STATUS_MESSAGE;
	update(message);
}

function disconnectEventSource() {
	if (!eventSource) return;

	stopKeepAlive();
	eventSource.removeEventListener('message', onMessage);
	eventSource.removeEventListener('error', onError);
	eventSource.close();
	eventSource = undefined;
}

function onError(event: Event) {
	// No way to identify the reason here so try long polling next
	if (
		eventSource?.readyState === READY_STATE_CLOSED &&
		connectStatus !== STATUS_MESSAGE
	) {
		connectStatus = STATUS_LONG_POLL;
		disconnectEventSource();
		setTimeout(start);
	}
	console.log('onError', event);
}

function connectEventSource(basepath: string) {
	const href = toHref(basepath, lastEventId);

	eventSource = new EventSource(href);
	connectStatus = STATUS_WAITING;
	eventSource.addEventListener('error', onError);
	eventSource.addEventListener('message', onMessage);
	startKeepAlive();
}

// --- BEGIN long polling

const LONG_POLL_WAIT_MS = 50; // 50 milliseconds
const BACKOFF_MS = 10000;
let startPollTimeout: ReturnType<typeof setTimeout> | undefined;
let abort: AbortController | undefined;
let aborted = 0;

function disconnectPoll() {
	stopKeepAlive();

	if (startPollTimeout) {
		clearTimeout(startPollTimeout);
		startPollTimeout = undefined;
	}

	if (abort) {
		abort.abort();
		abort = undefined;
	}
}

function pollFailed() {
	connectStatus = STATUS_FAILED;
	disconnectPoll();
}

async function fetchPoll(path: string) {
	startPollTimeout = undefined;
	console.assert(
		abort === undefined,
		'poll abort unexpectedly set (fetchPoll)'
	);

	let waitMs = -1;
	try {
		const href = toHref(path, lastEventId, false);
		abort = new AbortController();

		startKeepAlive();
		const response = await fetch(href, { signal: abort.signal });
		stopKeepAlive();

		if (response.ok) {
			const message = fromJson(await response.text());
			if (message) {
				lastEventId = String(message.timestamp);
				update(message);
				waitMs = LONG_POLL_WAIT_MS;
			}
		}
		aborted = 0;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			// Aborted by disconnectPoll() (via keepAlive)
			aborted += 1;
			waitMs = 0;
		} else {
			console.error('fetchPoll', error instanceof Error ? error.name : error);
		}
	} finally {
		if (waitMs > 0) {
			startPollTimeout = setTimeout(fetchPoll, waitMs, path);
		}
		if (waitMs < 0) {
			pollFailed();
		}
		abort = undefined;
	}
}

function nextPollConnect(count: number) {
	if (count < 1) return LONG_POLL_WAIT_MS;

	return BACKOFF_MS;
}

function connectPoll(path: string) {
	console.assert(
		abort === undefined,
		'poll abort unexpectedly set (connectPoll)'
	);
	startPollTimeout = setTimeout(fetchPoll, nextPollConnect(aborted), path);
}

// --- BEGIN Context consumer reference count
const [refCount, setRefCount] = createSignal(0);
const increment = (n: number) => n + 1;
const decrement = (n: number) => (n > 0 ? n - 1 : 0);

const disposeMessages = () => setRefCount(decrement);

// --- BEGIN Context Provider/Hook

const isActive = () => Boolean(eventSource || abort || startPollTimeout);

function disconnect() {
	if (eventSource) disconnectEventSource();
	else disconnectPoll();
}

function connect(basepath: string) {
	if (refCount() < 1) return;

	if (connectStatus !== STATUS_LONG_POLL) connectEventSource(basepath);
	else connectPoll(basepath);
}

function setupMessageConnection(basepath: string) {
	start = () => {
		disconnect();
		connect(basepath);
	};

	createEffect(() => {
		const count = refCount();

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
		if (message) contextHolder.reset(message);
	} else {
		const stream = server$(connectServerSource);
		setupMessageConnection(stream.url);
	}

	return (
		<MessageContext.Provider value={contextHolder.context}>
			{props.children}
		</MessageContext.Provider>
	);
}

function useMessages() {
	setRefCount(increment);
	return useContext(MessageContext);
}

export { MessageProvider, disposeMessages, useMessages };
