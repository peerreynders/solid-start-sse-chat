// file: src/server/sub/index.ts
import { nanoid } from 'nanoid';
import {
	epochTimestamp,
	isTimeValue,
	msSinceStart,
	MIN_TIMEVALUE,
} from '../../lib/shame';
import {
	makeClientRequest,
	makeKeepAlive,
	makeWelcome,
	type Message,
	type Welcome,
} from '../chat';
import { PUB_SUB_LINK, type SubBound } from '../pub-sub';
import { WelcomeYard, type Pending } from './welcome-yard';
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

type SubscriberCore = {
	clientId: string;
};

type SubscriberStream = SubscriberCore & {
	kind: typeof SUB_KIND.stream;
	controller: SourceController;
};

type SubscriberPoll = SubscriberCore & {
	kind: typeof SUB_KIND.longpoll;
	controller: PollController;
};

type SubscriberSSR = SubscriberCore & {
	kind: typeof SUB_KIND.ssr;
};

// type Subscriber =
//	| SubscriberStream
//	| SubscriberPoll
//	| SubscriberSSR;

const KEEP_ALIVE_MS = 15000; // 15 seconds
const REPLY_TIMEOUT_MS = 1500; // 1.5 seconds
const LONGPOLL_MIN_WAIT = 2000; // 2 secs

function clientIdFromData(data: unknown) {
	const clientId =
		data && typeof data === 'object' && 'clientId' in data
			? data.clientId
			: undefined;
	if (typeof clientId !== 'string')
		throw new Error('Missing property "clientId"');
	return clientId;
}

// The welcomeYard holds subscribers waiting
// for the `pub` area to respond
// to their subscription (ID) specific request
// for an intial history of
// messages-the `Welcome` message
//
// Past that point fresh messages coming from `pub`
// are distributed to SSE streams via the streamYard while
// longpoll subscriptions are served by the pollYard where
// messages to be included are aggregated by the
// messageRing which maintains a buffer of messages
// that cover twice the keep alive interval.
//
const welcomeYard = new WelcomeYard({
	makeTimedout: (item: Pending<unknown>) =>
		makeWelcome([], MIN_TIMEVALUE, clientIdFromData(item.data)),
	clearTimer: clearTimeout,
	setTimer: setTimeout,
	timeMs: msSinceStart,
});

const expireForStream = (now: number) => REPLY_TIMEOUT_MS + now;
let pubActive = false;
// For longpoll wait the full keep alive interval
// if `pub` hasn't responded yet
const expireForPoll = (now: number) =>
	pubActive ? REPLY_TIMEOUT_MS + now : KEEP_ALIVE_MS + now;
// For SSR don't hang around if `pub` hasn't responded yet
const expireForServer = (now: number) =>
	pubActive ? REPLY_TIMEOUT_MS + now : 300 + now;

// ---

function timeFromLastEventId(lastEventId: string | undefined) {
	const lastId = Number(lastEventId);
	return Number.isNaN(lastId) || !isTimeValue(lastId) ? undefined : lastId;
}

const toEventId = (timestamp: number) => String(timestamp);
const forwardMessage = (message: Message, send: SourceController['send']) =>
	send(JSON.stringify(message), toEventId(message.timestamp));

const channel = new BroadcastChannel(PUB_SUB_LINK);

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

// `streamYard` manages all the subscriber connections
// that use an event stream after they have
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

// `pollYard` manages all the subscriber connections
// that use longpolling requests.
// Requests that can't be covered within the messageRing's
// buffer are handled via the welcomeYard instead.
//
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
	const count =
		lastTime === undefined
			? -1
			: ring.countAfter(epochTimestamp(), lastTime, LONGPOLL_MIN_WAIT);
	if (count > -1 && lastTime) {
		// Serve longpoll with pollYard for `KeepAlive` or `Chat` messages
		// One browser can connect with multiple tabs so give each
		// a separate subscription ID (clientId only identifies the browser)
		const id = nanoid();
		const close = () => {
			const message = ring.toMessage(epochTimestamp(), args.clientId, lastTime);
			controller.close(JSON.stringify(message));
		};
		pollYard.add(close, id, count);

		return function unsubscribe() {
			pollYard.unsubscribe(id);
			// Note: controller.close() is calling this so don't call it again
		};
	}

	// Serve longpoll via welcomeYard instead
	const item: Pending<SubscriberPoll> = {
		id: nanoid(),
		expire: expireForPoll(msSinceStart()),
		send: (message) => {
			item.data.controller.close(JSON.stringify(message));
		},
		data: {
			kind: SUB_KIND.longpoll,
			clientId: args.clientId,
			controller,
		},
	};

	welcomeYard.add(item);
	sendClientRequest(item.id, lastTime);

	return function unsubscribe() {
		// Check Pending
		welcomeYard.take(item.id);
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
	const item: Pending<SubscriberStream> = {
		id: nanoid(),
		expire: expireForStream(msSinceStart()),
		send: (message) => {
			forwardMessage(message, item.data.controller.send);
			// Now just stream messages as they come in
			streamYard.add(item.data.controller.send, item.id);
		},
		data: {
			kind: SUB_KIND.stream,
			clientId: args.clientId,
			controller,
		},
	};
	welcomeYard.add(item);
	sendClientRequest(item.id, lastTime);

	return function unsubscribe() {
		// Check Pending
		const pendingItem = welcomeYard.take(item.id);
		if (!pendingItem) streamYard.unsubscribe(item.id);
		// Note: controller.close() is calling this so don't call it again
	};
}

function makeServerWelcome(clientId: string) {
	return new Promise<Welcome>((resolve, reject) => {
		const item: Pending<SubscriberSSR> = {
			id: nanoid(),
			expire: expireForServer(msSinceStart()),
			send: (message: SubBound) => {
				if (message.kind === 'welcome') resolve(message);
				else
					reject(new Error(`Expected Welcome message; got (${message.kind})`));
			},
			data: {
				kind: SUB_KIND.ssr,
				clientId,
			},
		};
		welcomeYard.add(item);
		sendClientRequest(item.id);
	});
}

// --- receiving pub message events
function receive(event: MessageEvent<SubBound>) {
	const message = event.data;
	pubActive = true;
	if (typeof message.id === 'string') {
		const item = welcomeYard.take(message.id);
		if (item) {
			// Replace internal subscription ID
			// with clientId before dispatch
			message.id = clientIdFromData(item.data);
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
