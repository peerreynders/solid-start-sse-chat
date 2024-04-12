// file: src/components/message-context/index.ts
import {
	createContext,
	createEffect,
	useContext,
	type ParentProps,
} from 'solid-js';
import { isServer } from 'solid-js/web';
import { basepathToMessages } from '../../route-path';
import { MESSAGES_LAST_EVENT_ID, SSE_FALLBACK_SEARCH_PAIR } from '../../api';

import { Streamer } from './streamer';
import { makeCount } from './reference-count';
import { fromJson, type Message } from '../../lib/chat';

const historyStore: Array<unknown> = [];
const MessageContext = createContext(historyStore);

// Once "wired up" `start` will `disconnect()` and then `connect()`. Used by
// - keepAlive action
// - to `try again` with long polling after SSE connection failed
// - when the `useMessage` reference count increases from 0.
let start: () => void | undefined;

// --- BEGIN  high-level connection (general)

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
let connectStatus = STATUS_IDLE;
let lastEventId: string | undefined;

// Connect to SSE getting all historical events:
//		https:/example.com/api/messages
// Connect to SSE with history after `eventId` 9999
//		https:/example.com/api/messages?liastEventId=9999
// Connect to long polling getting all historical events:
//		https:/example.com/api/messages?sseLongPoll=1
// Connect to long poling with history after `eventId` 9999
//		https:/example.com/api/messages?sseLongPoll=1&lastEventId=9999
//
function hrefToMessages(basepath: string, eventId?: string, viaSse = true) {
	const lastEvent = eventId
		? MESSAGES_LAST_EVENT_ID + '=' + encodeURIComponent(eventId)
		: undefined;

	const query = viaSse
		? lastEvent
		: lastEvent
			? `${SSE_FALLBACK_SEARCH_PAIR}&${lastEvent}`
			: SSE_FALLBACK_SEARCH_PAIR;

	return query ? `${basepath}?${query}` : basepath;
}

function update(message: Message) {
	console.log(message);
	/*
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
	*/
}

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
	beforeDisconnect: () => void (/* keepAlive.stop */ 0),
	afterConnect: () => {
		connectStatus = STATUS_WAITING;
		console.log('afterConnect');
		// keepAlive.start()
	},
	streamFailed: () => {
		connectStatus = STATUS_LONG_POLL;
		console.log('streamFailed');
		setTimeout(start);
	},
	handleMessageData: (data, eventId) => {
		console.log('data', data, eventId);
		// keepAlive.start()
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
// (see setupMessageConnection)
//
// The count is INCREMENTED every time `useMessages` is
// invoked. The count is DECREMENTED every time
// disposeMessages is invoked (in the onCleanup of the component)
//
const [referenceCount, references] = makeCount();
const disposeMessages = references.decrement;

// Is one of the low-level connections managing messages right now?
const isActive = () => streamer.active; /*|| polling.active */

// Both disconnect and connect delegate to the currently
// selected low-level connection method

function disconnect() {
	console.log('DISCONNECT');
	if (streamer.active) streamer.disconnect();
	// else polling.disconnect();
}

function connect(basepath: string) {
	console.log(referenceCount());
	if (referenceCount() < 1) return;

	if (connectStatus !== STATUS_LONG_POLL) {
		streamer.connect(hrefToMessages(basepath, lastEventId));
	}
	//else polling.connect(basepath);
}

// Bind module global high-level connection `start` function
// and hook into the reference count
// to start/stop the message connection
// based on the reference count to this module
//
function setupMessageConnection(basepath: string) {
	// populate module global `start` function
	start = () => {
		console.log('START');
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
}

function MessageProvider(props: ParentProps) {
	/*
	if (isServer) {
		const message = serverSideLoad();
		if (message) history.reset(message);
	} else {
		const stream = server$(connectServerSource);
		setupMessageConnection(stream.url);
	}
	*/
	if (!isServer) {
		setupMessageConnection(basepathToMessages());
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
