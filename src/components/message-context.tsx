// file: src/components/message-context

import { createContext, useContext, type ParentProps } from 'solid-js';
import { isServer } from 'solid-js/web';
import { createStore } from 'solid-js/store';

import { fromJson, type ChatMessage, type Welcome } from '~/lib/chat';

// --- BEGIN server side ---

import { parseCookie, useServerContext } from 'solid-start';

import server$, {
	ServerError,
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
	makeInitialMessage,
	//	sample as sampleEvents,
	subscribe as subscribeToSource,
} from '~/server/pub-sub';

async function connectServerSource(this: ServerFunctionEvent) {
	const info = requestInfo(this.request);
	const cookie = parseCookie(this.request.headers.get('cookie') ?? '');

	// Use `info.streamed === undefined` to force error to switch to fallback
	if (info.streamed) {
		let unsubscribe: (() => void) | undefined = undefined;

		const init: InitSource = (controller) => {
			const result = subscribeToSource(controller, {
				lastEventId: info.lastEventId,
				cookie: cookie,
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
	const pageEvent = useServerContext();
	const cookie = parseCookie(pageEvent.request.headers.get('cookie') ?? '');
	const [message, headers] = makeInitialMessage(cookie);

	if (headers) {
		for (const [name, value] of Object.entries(headers))
			pageEvent.responseHeaders.append(name, value);
	}

	return message.kind === 'welcome' ? message : undefined;
}

// --- END server side ---

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

let lastEventId: string | undefined;
let eventSource: EventSource | undefined;

function onMessage(event: MessageEvent<string>) {
	if (event.lastEventId) lastEventId = event.lastEventId;

	const message = fromJson(event.data);
	if (!message) return;

	switch (message.kind) {
		case 'chat': {
			console.log('chat', message);
			break;
		}

		case 'welcome': {
			contextHolder.reset(message);
			break;
		}
	}
}

function onError(event: Event) {
	// No way to identify the reason here so try long polling next
	console.log('onError', event);
}

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

function connect(basepath: string) {
	const href = toHref(basepath, lastEventId);

	eventSource = new EventSource(href);
	eventSource.addEventListener('error', onError);
	eventSource.addEventListener('message', onMessage);
}

function MessageProvider(props: ParentProps) {
	if (isServer) {
		const message = serverSideLoad();
		if (message) contextHolder.reset(message);
	} else {
		const stream = server$(connectServerSource);
		connect(stream.url);
	}

	return (
		<MessageContext.Provider value={contextHolder.context}>
			{props.children}
		</MessageContext.Provider>
	);
}

function useMessages() {
	return useContext(MessageContext);
}

export { MessageProvider, useMessages };
