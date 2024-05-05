// file: src/components/message-context/index.ts
import {
	batch,
	createContext,
	createEffect,
	useContext,
	type ParentProps,
} from 'solid-js';
import { isServer } from 'solid-js/web';
import { cache, revalidate } from '@solidjs/router';
import { basepathToMessages } from '../../route-path';
import {
	MESSAGES_LAST_EVENT_ID,
	SSE_FALLBACK_SEARCH_PAIR,
	welcomeSSR,
} from '../../api';
import { getHistoryStore } from '~/app-store';

import { makeHistoryState } from './message-history';
import { makeCount } from './reference-count';
import { DeadmanTimer } from './deadman-timer';
import { fromJson } from '../../lib/chat';
import { MIN_TIMEVALUE, msSinceStart } from '../../lib/shame';
import { Streamer } from './streamer';
import { Longpoller } from './longpoller';

import type { ChatMessage, Message, Welcome } from '../../lib/chat';
import type { History, HistoryAccess } from '../../types';
// import { scheduleCompare } from '~/lib/row-monitor';

//  0 - No connection attempted
//  1 - EventSource created
//  2 - At least one message received via event source
//  3 - Use longpoll fallback (event source had error before reaching 2)
// -1 - Connection failed (fallback also encountered an error; perhaps
//      identifying the reason for the event source failure)
const connectStatus = {
	FAILED: -1,
	IDLE: 0,
	WAITING: 1,
	MESSAGE: 2,
	LONGPOLL: 3,
} as const;

type ConnectStatus = (typeof connectStatus)[keyof typeof connectStatus];

// Connect to SSE getting all historical events:
//		https:/example.com/api/messages
// Connect to SSE with history after `eventId` 9999
//		https:/example.com/api/messages?liastEventId=9999
// Connect to long polling getting all historical events:
//		https:/example.com/api/messages?sseLongPoll=1
// Connect to long poling with history after `eventId` 9999
//		https:/example.com/api/messages?sseLongPoll=1&lastEventId=9999
//
function hrefToMessages(basepath: string, eventId?: string, viaSSE = true) {
	const lastEvent = eventId
		? MESSAGES_LAST_EVENT_ID + '=' + encodeURIComponent(eventId)
		: undefined;

	const query = viaSSE
		? lastEvent
		: lastEvent
			? `${SSE_FALLBACK_SEARCH_PAIR}&${lastEvent}`
			: SSE_FALLBACK_SEARCH_PAIR;

	return query ? `${basepath}?${query}` : basepath;
}

function setupLongpoll(
	lastEventId: () => string | undefined,
	update: (message: Message, eventId?: string) => void,
	setStatus: (status: ConnectStatus) => void,
	timeout: { start: () => void; stop: () => void }
) {
	const prepareMessageFetch = (basepath: string) => {
		const abort = new AbortController();
		const fn = async () => {
			let result = false;

			try {
				const href = hrefToMessages(basepath, lastEventId(), false);
				timeout.start();
				const response = await fetch(href, { signal: abort.signal });
				timeout.stop();

				if (response.ok) {
					const message = fromJson(await response.text());
					if (message) {
						update(message, String(message.timestamp));
						result = true;
					}
				}
			} catch (error) {
				timeout.stop();
				if (!(error instanceof DOMException && error.name === 'AbortError')) {
					// Wasn't aborted (by timeout)
					throw error;
				}
			}
			return result;
		};
		fn.abort = () => abort.abort();

		return fn;
	};

	return new Longpoller<ReturnType<typeof setTimeout>>({
		betweenMs: 50,
		backoffMs: 10000,
		schedule: (fetchPoll, delayMs, core) =>
			setTimeout(fetchPoll, delayMs, core),
		prepareMessageFetch,
		pollFailed: () => setStatus(connectStatus.FAILED),
		clearTimer: (id) => clearTimeout(id),
		cancelTimeout: timeout.stop,
	});
}

function setupSSE(
	update: (message: Message, eventId?: string) => void,
	start: () => void,
	setStatus: (status: ConnectStatus) => void,
	timeout: { start: () => void; stop: () => void }
) {
	// Streamer Configuration:
	// - After (re-)connect (but before first message received)
	//	shift status to `connectStatus.WAITING`
	//	(to detect a possible connection error later) and
	//	turn keepAlive ON.
	//
	// -Before disconnect turn `timeout` off
	//
	// - If the stream fails (error event while `connectStatus.WAITING`)
	// 	shift status to `connectStatus.LONG_POLL` to force the next
	// 	high-level connection attempt to use long polling instead.
	// 	Then schedule the next HIGH-LEVEL connection attempt.
	//
	// - When data is received, refresh (delay) the timeout,
	// 	cache the `eventId`, parse the message data. Ignore if the
	// 	data isn't a recognized data type.
	// 	If it is a recognized data type, shift/reassert `connectStatus.MESSAGE`
	// 	(i.e. a viable message connection) and submit the data for
	// 	further processing.
	//
	return new Streamer({
		beforeDisconnect: timeout.stop,
		afterConnect: () => {
			setStatus(connectStatus.WAITING);
			timeout.start();
		},
		streamFailed: () => {
			setStatus(connectStatus.LONGPOLL);
			setTimeout(start);
		},
		handleMessageData: (data, eventId) => {
			timeout.start();

			const message = fromJson(data);
			if (!message) return;

			setStatus(connectStatus.MESSAGE);
			update(message, eventId);
		},
	});
}

const NAME_HISTORY = 'message-history';
const NAME_CLIENT_ID = 'client-id';

// makes a `[store, mutators]` pair for the message history
// The store exposes the client ID `id` and an array of messages
// in `history` to be used by the UI.
//
// The `reset` mutator sets the client ID and message history
// from the `Welcome` message.
// The history is ignored `welcome.timestamp === MIN_TIMEVALUE`
//
// The `shunt` mutator add the messages at the head of the
// history array.
function makeHistory(): [
	HistoryAccess,
	{
		reset: (message: Welcome) => void;
		shunt: (recent: History | ChatMessage) => void;
	},
] {
	const state = makeHistoryState(
		() => revalidate(NAME_CLIENT_ID, true),
		() => revalidate(NAME_HISTORY, true)
	);

	// Create a `cache` to attach a
	// `createAsyncStore` to
	const getMessages = cache(() => {
		return Promise.resolve(state.history.value);
	}, NAME_HISTORY);

	// Create a `cache` to attach a
	// `createAsync` to
	const getClientId = cache(() => {
		return Promise.resolve(state.id);
	}, NAME_CLIENT_ID);

	return [
		{
			messages: () => getMessages(),
			clientId: () => getClientId(),
		},
		{
			reset: (message) => batch(() => state.reset(message)),
			shunt: state.shunt,
		},
	];
}

function initializeCSR() {
	const [historyAccess, history] = makeHistory();
	const context = createContext(historyAccess);

	// --- BEGIN  high-level connection (general)
	// To start with long polling, set to: connectStatus.LONGPOLL;
	let status: ConnectStatus = connectStatus.IDLE;
	const setStatus = (value: ConnectStatus) => (status = value);

	let lastId: string | undefined;
	const lastEventId = () => lastId;

	// `cycleConnection` is used by
	// - keepAlive action
	// - to `try again` with long polling after SSE connection failed
	// - when the `useMessage` reference count increases from 0.
	/* eslint prefer-const: ["error", { ignoreReadBeforeAssign: true }] */
	let connect: (() => void) | undefined;
	let disconnect: (() => void) | undefined;
	const cycleConnection = () => {
		disconnect?.();
		connect?.();
	};

	// Cycle the connection if there is no traffic
	// for `actionMs`
	const countdown = new DeadmanTimer<ReturnType<typeof setTimeout>>({
		actionMs: 20000, // 20 secs
		action: cycleConnection,
		timeMs: msSinceStart,
		schedule: (action, delay, core) => setTimeout(action, delay, core),
		clearTimer: (id) => clearTimeout(id),
	});

	// The `update` handler processes the
	// incoming message events; most importantly
	// to initialize the message history and
	// adding the most recent messages.
	const update = (message: Message, eventId?: string) => {
		if (eventId) lastId = eventId;
		switch (message.kind) {
			case 'chat': {
				if (message.timestamp > MIN_TIMEVALUE) history.shunt(message.messages);
				// scheduleCompare();
				break;
			}

			case 'welcome': {
				history.reset(message);
				// scheduleCompare();
				break;
			}

			case 'keep-alive': {
				// Nothing to do here - the idea is to keep the
				// connection from being closed
				console.log('keep-alive', message.timestamp);
				break;
			}
		}
	};

	// Start by trying SSE
	let streamer: Streamer | undefined = setupSSE(
		update,
		cycleConnection,
		setStatus,
		countdown
	);

	const connectCore = {
		connect: () => {
			if (streamer && status !== connectStatus.LONGPOLL) {
				streamer.connect(hrefToMessages(basepathToMessages(), lastEventId()));
				return;
			}

			// Replace streaming with long polling
			connectCore.disconnect();
			streamer = undefined;

			const poller = setupLongpoll(lastEventId, update, setStatus, countdown);
			connectCore.connect = () => poller.connect(basepathToMessages());
			connectCore.disconnect = poller.disconnect;
			connectCore.isActive = poller.isActive;
			connectCore.connect();
		},
		disconnect: streamer.disconnect,
		isActive: streamer.isActive,
	};

	// The high-level connection CONNECTS when `referenceCount`
	// goes ABOVE ZERO. It DISCONNECTS when it drops to ZERO.
	//
	// The count is INCREMENTED every time `useMessages` is
	// invoked. The count is DECREMENTED every time
	// disposeMessages is invoked (in the onCleanup of the component)
	//
	const [referenceCount, references] = makeCount();

	// Both disconnect and connect delegate to the currently
	// selected low-level connection method
	disconnect = () => {
		connectCore.disconnect();
	};

	connect = () => {
		if (referenceCount() < 1) return;

		connectCore.connect();
	};

	// Hook into the reference count
	// to start/stop the message connection
	// based on the reference count to this module
	//
	createEffect(() => {
		const count = referenceCount();
		if (connectCore.isActive()) {
			if (count < 1) disconnect();
		} else {
			if (count > 0) cycleConnection();
		}
	});

	return {
		context,
		decrementCount: references.decrement,
		incrementCount: references.increment,
		historyAccess,
	};
} // end function initializeCSR

function initializeSSR() {
	// The SSR version is only loaded once from the initial
	// welcome message.
	const p = welcomeSSR();
	const historyAccess = {
		clientId: () => p.then((welcome): string | undefined => welcome.id),
		messages: () => p.then((welcome) => welcome.messages),
	};
	const context = createContext(historyAccess);
	const noOp = () => void 0;

	return {
		context,
		decrementCount: noOp,
		incrementCount: noOp,
		historyAccess,
	};
}

const initialize = () => (isServer ? initializeSSR() : initializeCSR());

function HistoryProvider(props: ParentProps) {
	const store = getHistoryStore();
	const { context, historyAccess } =
		store.props ?? (store.props = initialize());
	return (
		<context.Provider value={historyAccess}>{props.children}</context.Provider>
	);
}

function useHistory() {
	const store = getHistoryStore();
	if (!store.props)
		throw new Error('useHistory only works under HistoryProvider');
	store.props.incrementCount();
	return useContext(store.props.context);
}

function disposeHistory() {
	const store = getHistoryStore();
	if (!store.props) throw new Error('disposeHistory: missing app store');
	store.props.decrementCount();
}

export { HistoryProvider, disposeHistory, useHistory };
