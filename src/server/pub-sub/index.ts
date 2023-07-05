// file: src/server/pub-sub/index.ts
import { customAlphabet } from 'nanoid';
import { FetchEvent } from 'solid-start/server';
import {
	PollController,
	SourceController,
} from '~/server/solid-start-sse-support';
import {
	makeChat,
	makeKeepAlive,
	makeWelcome,
	type ChatMessage,
	type Welcome,
} from '~/lib/chat';
import { isTimeValue } from '~/lib/shame';

import { MessageCache } from './message-cache';
import { IdleAction } from './idle-action';
import { Streamer, STREAMER_CHANGE } from './streamer';
import { Longpoller } from './longpoller';

const makeClientId = customAlphabet('1234567890abcdef', 7);

const epochTimestamp = Date.now;
const messageCache = new MessageCache();

// --- BEGIN keep-alive

const KEEP_ALIVE_MS = 15000; // 15 seconds
const msSinceStart = () => Math.trunc(performance.now());

const messageId = (timestamp: number) => String(timestamp);

const makeKeepAliveJson = (timestamp: number) =>
	JSON.stringify(makeKeepAlive(timestamp));

const makeKeepAliveNowJson = () => makeKeepAliveJson(epochTimestamp());

function dispatchKeepAlive() {
	const timestamp = epochTimestamp();
	streamer.send(makeKeepAliveJson(timestamp), messageId(timestamp));
}

const idleAction = new IdleAction({
	maxIdleMs: KEEP_ALIVE_MS,
	timeMs: msSinceStart,
	setTimer: (fn, delay) => setTimeout(fn, delay),
	clearTimer: (id) => clearTimeout(id),
	idleAction: dispatchKeepAlive,
});

// --- BEGIN Subscriptions

function timeFromLastEventId(lastEventId: string | undefined) {
	const lastId = Number(lastEventId);
	return Number.isNaN(lastId) || !isTimeValue(lastId) ? 0 : lastId;
}

const CLIENT_ID_NAME = '__client-id';

function newClientIdHeaders() {
	const clientId = makeClientId();
	const result: [string, Record<string, string>] = [
		clientId,
		{
			'set-cookie': `${CLIENT_ID_NAME}=${clientId}; HttpOnly; Path=/ ; SameSite=Lax`,
		},
	];
	return result;
}

const messageTimestamp = (messages: ChatMessage[]) =>
	messages.length > 0 ? messages[0].timestamp : epochTimestamp();

function makeMessageWelcome(clientId: string) {
	const messages = messageCache.sliceAfter();
	return makeWelcome(clientId, messages, messageTimestamp(messages));
}

function makeServerWelcome(maybeClientId: string | undefined) {
	const [clientId, headers] =
		maybeClientId && maybeClientId.length > 0
			? [maybeClientId, undefined]
			: newClientIdHeaders();

	const result: [Welcome, Record<string, string> | undefined] = [
		makeMessageWelcome(clientId),
		headers,
	];

	return result;
}

function makeMessageChat(lastTime: number) {
	const messages = messageCache.sliceAfter(lastTime);
	return makeChat(messages, messageTimestamp(messages));
}

const streamer = new Streamer({
	newClientIdHeaders,
	schedule: (add, core, receiver) => setTimeout(add, 0, core, receiver),
	clearTimer: (id) => clearTimeout(id),
	sendInitialMessage: (send, clientId, lastTime = 0) => {
		const message =
			lastTime > 0 ? makeMessageChat(lastTime) : makeMessageWelcome(clientId);
		send(JSON.stringify(message), messageId(message.timestamp));
	},
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

const subscribe = (
	controller: SourceController,
	args: { lastEventId: string | undefined; clientId: string | undefined }
) =>
	streamer.add(
		controller.send,
		args.clientId,
		timeFromLastEventId(args.lastEventId)
	);

// --- BEGIN Long polling
const longpoller = new Longpoller({
	respondChat: (close, lastTime) =>
		close(JSON.stringify(makeMessageChat(lastTime))),
	respondKeepAlive: (close) => close(makeKeepAliveNowJson()),
	respondWelcome: (close, maybeClientId) => {
		const [welcome, headers] = makeServerWelcome(maybeClientId);
		close(JSON.stringify(welcome), headers);
	},
	minMs: 2000, // 2 secs
	maxMs: KEEP_ALIVE_MS,
	timeMs: msSinceStart,
	setTimer: (fn, delay, arg) => setTimeout(fn, delay, arg),
	clearTimer: (id) => clearTimeout(id),
});

function longPoll(
	controller: PollController,
	args: { lastEventId: string | undefined; clientId: string | undefined }
) {
	const lastTime = timeFromLastEventId(args.lastEventId);
	const messages = args.lastEventId ? messageCache.sizeAfter(lastTime) : 0;
	return longpoller.add(controller.close, args.clientId, lastTime, messages);
}

// --- BEGIN Message dispatch

function send(body: string, clientId: string) {
	const message: ChatMessage = {
		timestamp: epochTimestamp(),
		from: clientId,
		body,
	};
	messageCache.cache(message);
	streamer.send(
		JSON.stringify(makeChat([message], message.timestamp)),
		messageId(message.timestamp)
	);
	longpoller.markMessage();
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
	makeServerWelcome,
	send,
	subscribe,
};
