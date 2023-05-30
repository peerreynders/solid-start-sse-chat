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

import { fromJson, type ChatMessage, type Welcome } from '~/lib/chat';

// --- BEGIN server side ---

import server$, {
	ServerError,
	useRequest,
	type ServerFunctionEvent,
} from 'solid-start/server';

import {
	SSE_FALLBACK_SEARCH_PAIR,
	//	eventSample,
	eventStream,
	requestInfo,
	//	type InitSample,
	type InitSource,
} from '~/server/solid-start-sse-support';
// NOTE: call `listen()` in `entry-server.tsx`

import {
	fromFetchEventClientId,
	makeInitialMessage,
	//	sample as sampleEvents,
	subscribe as subscribeToSource,
} from '~/server/pub-sub';

async function connectServerSource(this: ServerFunctionEvent) {
	const clientId = fromFetchEventClientId(this);
	const info = requestInfo(this.request);

	// Use `info.streamed === undefined` to force error to switch to fallback
	if (info.streamed) {
		let unsubscribe: (() => void) | undefined = undefined;

		const init: InitSource = (controller) => {
			const result = subscribeToSource(controller, {
				lastEventId: info.lastEventId,
				clientId,
			});
			unsubscribe = result.unsubscribe;

			const cleanup = () => {
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = undefined;
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

	throw new ServerError('Unsupported Media Type', { status: 415 });
}

function serverSideLoad() {
	const pageEvent = useRequest();
	const clientId = fromFetchEventClientId(pageEvent);
	const [message, headers] = makeInitialMessage(clientId);

	if (headers) {
		for (const [name, value] of Object.entries(headers))
			pageEvent.responseHeaders.append(name, value);
	}

	return message.kind === 'welcome' ? message : undefined;
}

// --- END server side ---

// --- BEGIN Context value

let currentHistory = 0;
const historyPool: [ChatMessage[], ChatMessage[]] = [[], []];

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

// --- BEGIN Keep alive timer

const KEEP_ALIVE_MS = 20000;
const msSinceStart = () => Math.trunc(performance.now());
let lastMessageMs = msSinceStart();
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

// --- BEGIN event source

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

let lastEventId: string | undefined;
let eventSource: EventSource | undefined;

function onMessage(event: MessageEvent<string>) {
	lastMessageMs = msSinceStart();
	if (event.lastEventId) lastEventId = event.lastEventId;

	const message = fromJson(event.data);
	if (!message) return;

	switch (message.kind) {
		case 'chat': {
			contextHolder.shuntMessages(message.messages);
			break;
		}

		case 'welcome': {
			contextHolder.reset(message);
			break;
		}

		case 'keep-alive': {
			break;
		}
	}
}

function onError(event: Event) {
	// No way to identify the reason here so try long polling next
	console.log('onError', event);
}

function disconnectEventSource() {
	if (!eventSource) return;

	stopKeepAlive();
	eventSource.removeEventListener('message', onMessage);
	eventSource.removeEventListener('error', onError);
	eventSource.close();
	eventSource = undefined;
}

function connectEventSource(basepath: string) {
	const href = toHref(basepath, lastEventId);

	eventSource = new EventSource(href);
	eventSource.addEventListener('error', onError);
	eventSource.addEventListener('message', onMessage);
	startKeepAlive();
}

// --- BEGIN Context consumer reference count
const [refCount, setRefCount] = createSignal(0);
const increment = (n: number) => n + 1;
const decrement = (n: number) => (n > 0 ? n - 1 : 0);

const disposeMessages = () => setRefCount(decrement);

// --- BEGIN Context Provider/Hook

function setupMessageConnection(basepath: string) {
	start = () => {
		disconnectEventSource();
		connectEventSource(basepath);
	};

	createEffect(() => {
		const count = refCount();

		if (count < 1) {
			disconnectEventSource();
			lastEventId = undefined;
			return;
		}

		if (count > 0) {
			if (eventSource) return;

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
