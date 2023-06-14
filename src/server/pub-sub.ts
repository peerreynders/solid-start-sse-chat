// file: src/server/pub-sub.ts
import { customAlphabet } from 'nanoid';
import { FetchEvent } from 'solid-start/server';
import { PollController, SourceController } from './solid-start-sse-support';
import {
	makeChat,
	makeKeepAlive,
	makeWelcome,
	type Chat,
	type ChatMessage,
	type KeepAlive,
	type Message,
	type Welcome,
} from '~/lib/chat';
import { isTimeValue } from '~/lib/shame';

import { MessageCache } from './message-cache';
import { IdleAction } from './idle-action';

const makeClientId = customAlphabet('1234567890abcdef', 7);

const epochTimestamp = Date.now;
const messageCache = new MessageCache();

// --- BEGIN keep-alive

const KEEP_ALIVE_MS = 15000; // 15 seconds
const msSinceStart = () => Math.trunc(performance.now());

const idleAction = new IdleAction({
	maxIdleMs: KEEP_ALIVE_MS,
	timeMs: msSinceStart,
	setTimer: (fn, delay) => setTimeout(fn, delay),
	clearTimer: (id) => clearTimeout(id),
	idleAction: () => sendMessage(makeKeepAlive(epochTimestamp())),
});

// --- BEGIN Subscriptions

const subscribers = new Set<SourceController>();

function addSubscriber(receiver: SourceController) {
	subscribers.add(receiver);
	idleAction.start();
}

function removeSubscriber(receiver: SourceController) {
	const lastSize = subscribers.size;
	subscribers.delete(receiver);
	if (subscribers.size === 0 && lastSize > 0) idleAction.stop();
}

function sendMessage(message: Message) {
	const json = JSON.stringify(message);
	const id = String(message.timestamp);
	for (const receiver of subscribers) {
		receiver.send(json, id);
	}
	idleAction.markAction();
}

const CLIENT_ID_NAME = '__client-id';

function makeClientIdCookie(id: string) {
	// Do not specify max-age or expires to create session cookie
	return `${CLIENT_ID_NAME}=${id}; HttpOnly; Path=/ ; SameSite=Lax`;
}

function makeMessageWelcome(maybeClientId: string | undefined) {
	const clientId =
		maybeClientId && maybeClientId.length > 0 ? maybeClientId : makeClientId();
	const headers =
		clientId !== maybeClientId
			? {
					'set-cookie': makeClientIdCookie(clientId),
			  }
			: undefined;

	const messages = messageCache.sliceAfter();
	const timestamp =
		messages.length > 0 ? messages[0].timestamp : epochTimestamp();
	const tuple: [Welcome, Record<string, string> | undefined] = [
		makeWelcome(clientId, messages, timestamp),
		headers,
	];
	return tuple;
}

function makeMessageChat(lastTime: number) {
	const messages = messageCache.sliceAfter(lastTime);
	const timestamp =
		messages.length > 0 ? messages[0].timestamp : epochTimestamp();
	return makeChat(messages, timestamp);
}

const makeInitialMessage = (maybeClientId: string | undefined, lastTime = 0) =>
	lastTime < 1 || !maybeClientId
		? makeMessageWelcome(maybeClientId)
		: ([makeMessageChat(lastTime), undefined] as [Chat, undefined]);

function timeFromLastEventId(lastEventId: string | undefined) {
	const lastId = Number(lastEventId);
	return Number.isNaN(lastId) || !isTimeValue(lastId) ? 0 : lastId;
}

function subscribe(
	controller: SourceController,
	args: { lastEventId: string | undefined; clientId: string | undefined }
) {
	const lastTime = timeFromLastEventId(args.lastEventId);

	// 0. waiting -> 1. subscribed -> 2. unsubscribed
	let status = 0;
	let receiver: SourceController | undefined;

	const [message, headers] = makeInitialMessage(args.clientId, lastTime);
	const finalize = () => {
		if (status > 0) return;

		receiver = controller;

		const messageId = epochTimestamp().toString();
		const json = JSON.stringify(message);
		controller.send(json, messageId);

		addSubscriber(receiver);
		status = 1;
	};

	const unsubscribe = () => {
		const previous = status;
		status = 2;
		// subscription didn't finish, but will not subscribe
		if (previous < 1) return true;

		// already unsubscribed
		if (!receiver) return false;

		// actually unsubscribe
		removeSubscriber(receiver);
		receiver = undefined;
		return true;
	};

	queueMicrotask(finalize);

	return {
		unsubscribe,
		headers,
	};
}

// --- BEGIN Long polling

type MessagePoll = {
	cancel: PollController['cancel'];
	close: PollController['close'];
	clientId: string;
	lastTime: number;
	arrived: number;
	messages: number;
};

const MIN_POLL_MS = 2000; // 2 seconds
const messagePolls = new Set<MessagePoll>();
let pollSweepTimeout: ReturnType<typeof setTimeout> | undefined;
let nextPollSweep = 0;

function stopPollSweep() {
	if (!pollSweepTimeout) return;

	clearTimeout(pollSweepTimeout);
	pollSweepTimeout = undefined;
	nextPollSweep = 0;
}

function schedulePollSweep() {
	if (messagePolls.size < 1) return stopPollSweep();

	const head = messagePolls.values().next().value as MessagePoll;
	const respondBy =
		head.arrived + (head.messages < 1 ? KEEP_ALIVE_MS : MIN_POLL_MS);
	const now = msSinceStart();

	if (now < respondBy && nextPollSweep === respondBy) return;

	if (pollSweepTimeout) clearTimeout(pollSweepTimeout);

	nextPollSweep = respondBy;
	pollSweepTimeout = setTimeout(releasePolls, nextPollSweep - now);
}

const sendPoll = (poll: MessagePoll, message: Message) =>
	poll.close(JSON.stringify(message));

function releasePolls() {
	pollSweepTimeout = undefined;
	nextPollSweep = 0;

	const now = msSinceStart();
	let keepAlive: KeepAlive | undefined;
	for (const poll of messagePolls) {
		if (
			now < poll.arrived + MIN_POLL_MS ||
			(now < poll.arrived + KEEP_ALIVE_MS && poll.messages < 1)
		)
			break;

		messagePolls.delete(poll);
		const message =
			poll.messages === 0
				? keepAlive
					? keepAlive
					: (keepAlive = makeKeepAlive(epochTimestamp()))
				: makeMessageChat(poll.lastTime);
		sendPoll(poll, message);
	}

	schedulePollSweep();
}

function markMessagePolls(message: Chat) {
	const now = msSinceStart();
	for (const poll of messagePolls) {
		poll.messages += 1;
		if (now <= poll.arrived + MIN_POLL_MS) continue;

		messagePolls.delete(poll);
		if (poll.messages === 1) {
			sendPoll(poll, message);
			continue;
		}

		sendPoll(poll, makeMessageChat(poll.lastTime));
	}

	schedulePollSweep();
}

function longPoll(
	controller: PollController,
	args: { lastEventId: string | undefined; clientId: string | undefined }
) {
	const lastTime = timeFromLastEventId(args.lastEventId);
	if (lastTime === 0 || !args.clientId) {
		const [message, headers] = makeMessageWelcome(args.clientId);
		controller.close(JSON.stringify(message), headers);

		return undefined;
	}

	const poll: MessagePoll = {
		close: controller.close,
		cancel: controller.cancel,
		clientId: args.clientId,
		lastTime,
		arrived: msSinceStart(),
		messages: messageCache.sizeAfter(lastTime),
	};

	const unregister = () => {
		messagePolls.delete(poll);
		schedulePollSweep();
	};

	messagePolls.add(poll);
	schedulePollSweep();

	return unregister;
}

// --- BEGIN Message dispatch

function send(body: string, clientId: string) {
	const message: ChatMessage = {
		timestamp: epochTimestamp(),
		from: clientId,
		body,
	};
	messageCache.cache(message);
	const chat = makeChat([message], message.timestamp);
	sendMessage(chat);
	markMessagePolls(chat);
}

// --- BEGIN support utilities

function fromRequestClientId(request: Request) {
	const cookie = request.headers.get('cookie');
	if (!cookie) return undefined;

	const name = cookie.indexOf(CLIENT_ID_NAME);
	if (name < 0) return undefined;

	const separator = cookie.indexOf('=', name);
	if (separator < 0) return undefined;

	const after = cookie.indexOf(',', separator);
	const indexEnd = after < 0 ? cookie.length : after;

	const clientId = cookie.slice(separator + 1, indexEnd).trim();

	return clientId.length > 0 ? clientId : undefined;
}

const fromFetchEventClientId = (event: FetchEvent) =>
	CLIENT_ID_NAME in event.locals &&
	typeof event.locals[CLIENT_ID_NAME] === 'string'
		? event.locals[CLIENT_ID_NAME]
		: undefined;

export {
	CLIENT_ID_NAME,
	fromFetchEventClientId,
	fromRequestClientId,
	longPoll,
	makeMessageWelcome,
	send,
	subscribe,
};
