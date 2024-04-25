// file: src/server/sub/index.ts
import { nanoid } from 'nanoid';
import { epochTimestamp, isTimeValue, MIN_TIMEVALUE } from '../../lib/shame';
import {
	makeClientReply,
	makeClientRequest,
	makeKeepAlive,
	type Message,
	type Welcome,
} from '../chat';
import { PUB_SUB_LINK, type SubBound } from '../pub-sub';
import { Streamer, STREAMER_CHANGE } from './streamer';
import { IdleAction } from './idle-action';

import type { SourceController } from '../event-stream';

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

type PendingSSR = PendingCore & {
	kind: typeof SUB_KIND.ssr;
};

type Pending = PendingStream | PendingSSR;

const KEEP_ALIVE_MS = 15000; // 15 seconds
const REPLY_TIMEOUT_MS = 1500; // 1.5 seconds

function timeFromLastEventId(lastEventId: string | undefined) {
	const lastId = Number(lastEventId);
	return Number.isNaN(lastId) || !isTimeValue(lastId) ? undefined : lastId;
}

const toEventId = (timestamp: number) => String(timestamp);
const forwardMessage = (message: Message, send: SourceController['send']) =>
	send(JSON.stringify(message), toEventId(message.timestamp));

const msSinceStart = () => Math.trunc(performance.now());

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
	forwardMessage(makeKeepAlive(epochTimestamp()), streamer.send);

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
const streamer = new Streamer({
	onChange: (kind) => {
		switch (kind) {
			case STREAMER_CHANGE.messageSent:
				return idleAction.markAction();

			case STREAMER_CHANGE.running:
				return idleAction.start();

			case STREAMER_CHANGE.idle:
				return idleAction.stop();
		}
	},
});

// --- exports
function subscribe(
	controller: SourceController,
	args: { clientId: string; lastEventId: string | undefined }
) {
	// Need a separate subscription ID
	// to support multiple connections
	// from the same browser
	// which would share the same `clientId`
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
			streamer.add(item.controller.send, item.id);
		},
	} as const;
	pending.set(item.id, item);
	scheduleTimeout();

	const message = makeClientRequest(
		item.id,
		timeFromLastEventId(args.lastEventId)
	);
	console.log('SUB: PubBound', message);
	channel.postMessage(message);

	return function unsubscribe() {
		// Check Pending
		const pendingItem = takePending(item.id);
		console.log('SUB unsubscribe', item.id, item.clientId, pendingItem);
		if (!pendingItem) streamer.unsubscribe(item.id);
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

		const message = makeClientRequest(item.id);
		console.log('SUB: PubBound(1)', message);
		channel.postMessage(message);
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
		// forward to streaming responsesit
		forwardMessage(message, streamer.send);

		// TODO forward to longpolling
	}
}

channel.addEventListener('message', receive);

export { makeServerWelcome, subscribe };
