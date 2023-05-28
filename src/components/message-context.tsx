// file: src/components/message-context

import { createContext, useContext, type ParentProps } from 'solid-js';
import { isServer } from 'solid-js/web';
import { createStore } from 'solid-js/store';

import { fromJson, type ChatMessage } from '~/lib/chat';

// --- BEGIN server side ---

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
	//	sample as sampleEvents,
	subscribe as subscribeToSource,
} from '~/server/pub-sub';

async function connectServerSource(this: ServerFunctionEvent) {
	const info = requestInfo(this.request);

	// Use `info.streamed === undefined` to force error to switch to fallback
	if (info.streamed) {
		let unsubscribe: (() => void) | undefined = undefined;

		const init: InitSource = (controller) => {
			unsubscribe = subscribeToSource(controller, info.lastEventId);

			return () => {
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = undefined;
				}
				console.log('source closed');
			};
		};

		return eventStream(this.request, init);
	}

	throw new ServerError('Unsupported Media Type', { status: 415 });
}

// --- END server side ---

let currentHistory = 0;
const historyPool: [ChatMessage[], ChatMessage[]] = [[], []];

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
	return historyPool[currentHistory];
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
	const setClientId = (id: string) => set('id', id);

	return {
		context: store,
		shuntMessages,
		setClientId,
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
			const clientId = contextHolder.context.id;
			if (clientId) return;

			contextHolder.setClientId(message.id);
			contextHolder.shuntMessages(message.messages);
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
	if (!isServer) {
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
