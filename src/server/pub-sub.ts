// file: src/server/pub-sub.ts
import { customAlphabet } from 'nanoid';
import { FetchEvent } from 'solid-start/server';
import { SourceController } from './solid-start-sse-support';
import {
	makeChat,
	makeWelcome,
	type Chat,
	type ChatMessage,
	type Welcome,
} from '~/lib/chat';
import { isTimeValue } from '~/lib/shame';

const makeClientId = customAlphabet('1234567890abcdef', 12);

//const msSinceStart = () => Math.trunc(performance.now());
const epochTimestamp = Date.now;

// --- BEGIN Cache
type MessageCache = {
	buffer: ChatMessage[][];
	latest: ChatMessage[];
};

const MAX_MESSAGES = 16;
const messageCache: MessageCache = {
	buffer: [],
	latest: [],
};

function cacheMessage(message: ChatMessage) {
	messageCache.latest.push(message);
	if (messageCache.latest.length >= MAX_MESSAGES) {
		messageCache.buffer.push(messageCache.latest);
		messageCache.latest = [];
	}
}

function copyHistory({ buffer, latest }: MessageCache, after = 0) {
	const copy = [];
	for (
		let source = latest, k = buffer.length, j = source.length - 1, i = 0;
		k > 0 || j >= 0;
		i += 1, j -= 1
	) {
		if (j < 0) {
			k -= 1;
			source = buffer[k];
			j = source.length - 1;
		}
		const message = source[j];
		if (message.timestamp <= after) break;

		copy[i] = message;
	}

	return copy;
}

// --- BEGIN Subscriptions

const subscribers = new Set<SourceController>();
//let lastSend = 0;

const CLIENT_ID_NAME = '__client-id';

function makeClientIdCookie(id: string) {
	// Do not specify max-age or expires to create session cookie
	return `${CLIENT_ID_NAME}=${id}; HttpOnly; Path=/ ; SameSite=Lax`;
}

function makeInitialMessage(maybeClientId: string | undefined, lastTime = 0) {
	const previousClient = maybeClientId && maybeClientId.length > 0;
	const clientId = previousClient ? maybeClientId : makeClientId();
	const messages = copyHistory(messageCache, lastTime);

	if (lastTime > 0 && previousClient) {
		const result: [Chat, undefined] = [makeChat(messages), undefined];

		return result;
	}

	const headers = previousClient
		? undefined
		: {
				'set-cookie': makeClientIdCookie(clientId),
		  };

	const result: [Welcome, Record<string, string> | undefined] = [
		makeWelcome(clientId, messages),
		headers,
	];

	return result;
}

function subscribe(
	controller: SourceController,
	args: { lastEventId: string | undefined; clientId: string | undefined }
) {
	const lastId = Number(args.lastEventId);
	const lastTime = Number.isNaN(lastId) || !isTimeValue(lastId) ? 0 : lastId;

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

		subscribers.add(receiver);
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
		subscribers.delete(receiver);
		receiver = undefined;
		return true;
	};

	queueMicrotask(finalize);

	return {
		unsubscribe,
		headers,
	};
}

function send(body: string, clientId: string) {
	const message: ChatMessage = {
		timestamp: epochTimestamp(),
		from: clientId,
		body,
	};
	cacheMessage(message);
	console.log('send', message);
}

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
	makeInitialMessage,
	send,
	subscribe,
};
