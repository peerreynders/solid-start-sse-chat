// file: src/server/sub/index.ts
import { nanoid } from 'nanoid';
import { epochTimestamp, isTimeValue, msSinceStart, MIN_TIMEVALUE } from '../../lib/shame';
import {
	makeClientReply,
	makeClientRequest,
	makeKeepAlive,
	type Message,
	type Welcome,
} from '../chat';
import { PUB_SUB_LINK, type SubBound } from '../pub-sub';
import { StreamYard, STREAM_YARD_CHANGE } from './stream-yard';
import { PollYard } from './poll-yard';
import { MessageRing } from './message-ring';
import { IdleAction } from './idle-action';

import type { SourceController } from '../event-stream';
import type { PollController } from '../event-poll';

const SUB_KIND = {
	stream: 0,
	longpoll: 1,
	ssr: 2,
} as const;
// type SubKind = (typeof SUB_KIND)[keyof typeof SUB_KIND];

type Send = (welcome: SubBound) => void;
type PendingCore = {
	id: string;
	clientId: string;
	expire: number;
	send: Send;
};

type PendingStream = PendingCore & {
	kind: typeof SUB_KIND.stream;
	controller: SourceController;
};

type PendingLongpoll = PendingCore & {
	kind: typeof SUB_KIND.longpoll;
	controller: PollController;
};

type PendingSSR = PendingCore & {
	kind: typeof SUB_KIND.ssr;
};

type Pending = PendingStream | PendingLongpoll | PendingSSR;

const KEEP_ALIVE_MS = 15000; // 15 seconds
const REPLY_TIMEOUT_MS = 1500; // 1.5 seconds

function timeFromLastEventId(lastEventId: string | undefined) {
	const lastId = Number(lastEventId);
	return Number.isNaN(lastId) || !isTimeValue(lastId) ? undefined : lastId;
}

const toEventId = (timestamp: number) => String(timestamp);
const forwardMessage = (message: Message, send: SourceController['send']) =>
	send(JSON.stringify(message), toEventId(message.timestamp));

const pending = new Map<string, Pending>();
const channel = new BroadcastChannel(PUB_SUB_LINK);

// --- reply time out

// Need to time out if `src/server/pub.ts` doesn't reply
let timeoutId: ReturnType<typeof setTimeout> | undefined; // Hold the requests that are waiting for a reply

// Note: Expiry Scheduling is assumed to follow order
// of scheduling; items scheduled later
// are assumed to expire later.
function scheduleTimeout(delay = REPLY_TIMEOUT_MS) {
	if (timeoutId) return;
	timeoutId = setTimeout(replyTimeout, delay);
}

// Note: this is entirely synchronous
function replyTimeout() {
	const replyTo = [];
	let last: Pending | undefined;

	// We don't bother clearing timeouts
	// instead we may find there is just nothing to do

	// values() iterates in insertion order
	// i.e. oldest first
	for (const item of pending.values()) {
		const now = msSinceStart();
		if (now < item.expire) {
			last = item;
			break;
		}

		replyTo.push(item);
		pending.delete(item.id);
	}

	timeoutId = undefined;
	// There are still items waiting for a reply
	if (last) scheduleTimeout(last.expire - msSinceStart());

	// No need to be (a)waiting around
	// Just send an empty chat reply
	for (let i = 0; i < replyTo.length; i += 1)
		replyTo[i].send(makeClientReply([], MIN_TIMEVALUE, replyTo[i].clientId));
}

// --- pending management

// Takes item off the pending map
// - Doesn't worry about clearing timeout
function takePending(takeId: string) {
	const item = pending.get(takeId);
	if (!item) return undefined;

	const r = pending.delete(takeId);
	console.log('take', takeId, r);
	return item;
}

// --- keep alive messages (for event streams)
const dispatchKeepAlive = (): void =>
	forwardMessage(makeKeepAlive(epochTimestamp()), streamYard.send);

const idleAction = new IdleAction({
	maxIdleMs: KEEP_ALIVE_MS,
	timeMs: msSinceStart,
	setTimer: (fn, delay) => setTimeout(fn, delay),
	clearTimer: (id) => clearTimeout(id),
	idleAction: dispatchKeepAlive,
});

// `streamer` manages all the client connections
// that use an event stream after the have
// received a welcome message
//
const streamYard = new StreamYard({
	onChange: (kind) => {
		switch (kind) {
			case STREAM_YARD_CHANGE.messageSent:
				return idleAction.markAction();

			case STREAM_YARD_CHANGE.running:
				return idleAction.start();

			case STREAM_YARD_CHANGE.idle:
				return idleAction.stop();
		}
	},
});

const LONGPOLL_MIN_WAIT = 2000;

const pollYard = new PollYard<ReturnType<typeof setTimeout>>({
	maxMs: KEEP_ALIVE_MS,
	minMs: LONGPOLL_MIN_WAIT, 
	clearTimer: clearTimeout,
	setTimer: setTimeout,
	timeMs: msSinceStart,
});

const ring = new MessageRing(KEEP_ALIVE_MS * 2);

function sendClientRequest(itemId: string, lastTime?: number) {
	const message = makeClientRequest(itemId, lastTime);
	console.log('SUB: PubBound', message);
	channel.postMessage(message);
}

// --- exports
function longpoll(
	controller: PollController,
	args: { clientId: string; lastEventId: string | undefined }
) {
	// Longpoll goes straight to the pollYard if the buffered messages
	// are enough for a Chat
	const lastTime = timeFromLastEventId(args.lastEventId);
	const count = lastTime === undefined ? -1 : ring.countAfter(epochTimestamp(),lastTime, LONGPOLL_MIN_WAIT);
	if (count > -1 && lastTime) {
		// Serve longpoll with pollYard for `keepAlive` or `Chat`
		// One browser can connect with multiple tabs so give each
		// a separate id (clientId only identified the browser)
		const id = nanoid();
		const close = () => {
			const message = ring.toMessage(epochTimestamp(), args.clientId, lastTime);
			controller.close(JSON.stringify(message));
			console.log('pollyard close', message, id);
		};
		pollYard.add(close, id, count);

		return function unsubscribe() {
			pollYard.unsubscribe(id);
			console.log('POLL(yard) unsubscribe', args.clientId, id);
			// Note: controller.close() is calling this so don't call it again
		};
	}

	// Serve longpoll via pending queue for `Welcome`
	const item = {
		kind: SUB_KIND.longpoll,
		id: nanoid(),
		clientId: args.clientId,
		controller,
		expire: REPLY_TIMEOUT_MS + msSinceStart(),
		send: (message: SubBound) => {
			item.controller.close(JSON.stringify(message));
			console.log('pending close', message);
		},
	} as const;

	pending.set(item.id, item);
	scheduleTimeout();
	sendClientRequest(item.id, lastTime);

	return function unsubscribe() {
		// Check Pending
		const pendingItem = takePending(item.id);
		console.log('POLL(pending) unsubscribe', item.id, item.clientId, pendingItem);
		// Note: controller.close() is calling this so don't call it again
	};
}

function subscribe(
	controller: SourceController,
	args: { clientId: string; lastEventId: string | undefined }
) {
	// Need a separate subscription ID
	// to support multiple connections
	// from the same browser
	// which would share the same `clientId`
	const lastTime = timeFromLastEventId(args.lastEventId);
	const item = {
		kind: SUB_KIND.stream,
		id: nanoid(),
		clientId: args.clientId,
		controller,
		expire: REPLY_TIMEOUT_MS + msSinceStart(),
		send: (message: SubBound) => {
			forwardMessage(message, item.controller.send);
			console.log('send', message);

			// Now just stream messages as they come in
			streamYard.add(item.controller.send, item.id);
		},
	} as const;
	pending.set(item.id, item);
	scheduleTimeout();
	sendClientRequest(item.id, lastTime);

	return function unsubscribe() {
		// Check Pending
		const pendingItem = takePending(item.id);
		console.log('SUB unsubscribe', item.id, item.clientId, pendingItem);
		if (!pendingItem) streamYard.unsubscribe(item.id);
		// Note: controller.close() is calling this so don't call it again
	};
}

function makeServerWelcome(clientId: string) {
	return new Promise<Welcome>((resolve, reject) => {
		const item = {
			kind: SUB_KIND.ssr,
			id: nanoid(),
			clientId,
			expire: REPLY_TIMEOUT_MS + msSinceStart(),
			send: (message: SubBound) => {
				console.log('send(1)', message);
				if (message.kind === 'welcome') resolve(message);
				else
					reject(new Error(`Expected Welcome message; got (${message.kind})`));
			},
		} as const;
		console.log('makeServerWelcome');
		pending.set(item.id, item);
		scheduleTimeout();
		sendClientRequest(item.id);
	});
}

// --- receiving pub message events
function receive(event: MessageEvent<SubBound>) {
	const message = event.data;
	if (typeof message.id === 'string') {
		const item = takePending(message.id);
		if (item) {
			// Replace internal subscription ID
			// with clientId before dispatch
			message.id = item.clientId;
			item.send(message);
		}

	} else if (message.kind === 'chat') {
		ring.push(epochTimestamp(), message);
		// forward to streaming responses
		forwardMessage(message, streamYard.send);

		// Notify polls that messages have arrived
		pollYard.mark(message.messages.length);
	}
}

channel.addEventListener('message', receive);

export { longpoll, makeServerWelcome, subscribe };
