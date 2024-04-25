// file: src/components/message-context/index.ts
import {
	createContext,
	createEffect,
	useContext,
	type ParentProps,
} from 'solid-js';
import { isServer } from 'solid-js/web';
import { basepathToMessages } from '../../route-path';
import {
	MESSAGES_LAST_EVENT_ID,
	SSE_FALLBACK_SEARCH_PAIR,
	welcomeSSR,
} from '../../api';
import { getHistoryStore } from '~/app-store';

import { Streamer } from './streamer';
import { makeHistory } from './message-history';
import { makeCount } from './reference-count';
import { DeadmanTimer, type ActionId } from './deadman-timer';
import { fromJson, type Message } from '../../lib/chat';
import { MIN_TIMEVALUE, msSinceStart } from '../../lib/shame';

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
const _STATUS_FAILED = -1;

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

function initializeCSR() {
	const [historyAccess, history] = makeHistory();
	const context = createContext(historyAccess);

	// --- BEGIN  high-level connection (general)

	// Once "wired up" `start` will `disconnect()` and then `connect()`. Used by
	// - keepAlive action
	// - to `try again` with long polling after SSE connection failed
	// - when the `useMessage` reference count increases from 0.
	let connectStatus = STATUS_IDLE;
	let lastEventId: string | undefined;
	let cycleConnection: undefined | (() => void);
	const start = () => cycleConnection?.();
	// Cycle the connection if there is no traffic
	// for `actionMs`
	const countdown = new DeadmanTimer({
		actionMs: 20000, // 20 secs
		action: start,
		timeMs: msSinceStart,
		schedule: (action, delay, core) => setTimeout(action, delay, core),
		clearTimer: (id: ActionId) => clearTimeout(id),
	});

	// The `update` handler processes the
	// incoming message events; most importantly
	// to initialize the message history and
	// adding the most recent messages.
	const update = (message: Message) => {
		console.log(message);
		switch (message.kind) {
			case 'chat': {
				if (message.timestamp > MIN_TIMEVALUE) history.shunt(message.messages);

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
				// Nothing to do here - the idea is to keep the
				// connection from being closed
				console.log('keep-alive', message.timestamp);
				break;
			}
		}
	};

	// --- BEGIN low-level SSE connection

	// Streamer Configuration:
	// - After (re-)connect (but before first message received)
	//	shift status to `STATUS_WAITING`
	//	(to detect a possible connection error later) and
	//	turn keepAlive ON.
	//
	// -Before disconnect turn KeepAlive off
	//
	// - If the stream fails (error event while `STATUS_WAITING`)
	// 	shift status to `STATUS_LONG_POLL` to force the next
	// 	high-level connection attempt to use long polling instead.
	// 	Then schedule the next HIGH-LEVEL connection attempt.
	//
	// - When data is received, refresh (delay) the keepAlive,
	// 	cache the `eventId`, parse the message data. Ignore if the
	// 	data isn't a recognized data type.
	// 	If it is a recognized data type, shift/reassert `STATUS_MESSAGE`
	// 	(i.e. a viable message connection) and submit the data for
	// 	further processing.
	//
	const streamer = new Streamer({
		beforeDisconnect: () => countdown.stop(),
		afterConnect: () => {
			connectStatus = STATUS_WAITING;
			console.log('afterConnect');
			countdown.start()
		},
		streamFailed: () => {
			connectStatus = STATUS_LONG_POLL;
			console.log('streamFailed');
			setTimeout(start);
		},
		handleMessageData: (data, eventId) => {
			console.log('data', data, eventId);
			countdown.start()
			if (eventId) lastEventId = eventId;

			const message = fromJson(data);
			console.log('message', message);
			if (!message) return;

			connectStatus = STATUS_MESSAGE;
			update(message);
		},
	});

	// --- CONTINUE High-level connection (using low-level controllers)

	// The high-level connection CONNECTS when `referenceCount`
	// goes ABOVE ZERO. It DISCONNECTS when it drops to ZERO.
	//
	// The count is INCREMENTED every time `useMessages` is
	// invoked. The count is DECREMENTED every time
	// disposeMessages is invoked (in the onCleanup of the component)
	//
	const [referenceCount, references] = makeCount();

	// Is one of the low-level connections managing messages right now?
	const isActive = () => streamer.active; /*|| polling.active */

	// Both disconnect and connect delegate to the currently
	// selected low-level connection method
	const disconnect = () => {
		console.log('DISCONNECT');
		if (streamer.active) streamer.disconnect();
		// else polling.disconnect();
	};

	const connect = (basepath: string) => {
		console.log(referenceCount());
		if (referenceCount() < 1) return;

		if (connectStatus !== STATUS_LONG_POLL) {
			streamer.connect(hrefToMessages(basepath, lastEventId));
		}
		//else polling.connect(basepath);
	};

	// Bind high-level connection `start` function
	// and hook into the reference count
	// to start/stop the message connection
	// based on the reference count to this module
	//
	const basepath = basepathToMessages();
	cycleConnection = () => {
		console.log('CYCLE');
		disconnect();
		connect(basepath);
	};

	createEffect(() => {
		const count = referenceCount();
		const active = isActive();
		console.log('COUNT', count, active);
		if (isActive()) {
			if (count < 1) disconnect();
		} else {
			if (count > 0) start();
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
	const noOp = () => void 0;
	const [historyAccess] = makeHistory(welcomeSSR());
	const context = createContext(historyAccess);

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
