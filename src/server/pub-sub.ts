// file: src/server/pub-sub.ts
import { customAlphabet } from 'nanoid';
import { ServerError } from 'solid-start';
import { SourceController } from './solid-start-sse-support';
import { makeChat, makeWelcome, type Chat, type Welcome } from '~/lib/chat';
import { isTimeValue } from '~/lib/shame';

const makeClientId = customAlphabet('1234567890abcdef', 12);

//const msSinceStart = () => Math.trunc(performance.now());
const epochTimestamp = Date.now;

// --- BEGIN Subscriptions

const subscribers = new Set<SourceController>();
//let lastSend = 0;

const CLIENT_ID_NAME = '__client-id';

const fromCookieClientId = (cookie: Record<string, string>) =>
	Object.hasOwn(cookie, CLIENT_ID_NAME) ? cookie[CLIENT_ID_NAME] : undefined;

function makeClientIdCookie(id: string) {
	// Do not specify max-age or expires to create session cookie
	return `${CLIENT_ID_NAME}=${id}; HttpOnly; Path=/ ; SameSite=Lax`;
}

function makeInitialMessage(cookie: Record<string, string>, lastTime = 0) {
	const cookieClient = fromCookieClientId(cookie);
	const clientId = cookieClient ? cookieClient : makeClientId();

	if (lastTime > 0 && cookieClient) {
		const result: [Chat, undefined] = [makeChat([]), undefined];

		return result;
	}

	const headers = cookieClient
		? undefined
		: {
				'set-cookie': makeClientIdCookie(clientId),
		  };

	const result: [Welcome, Record<string, string> | undefined] = [
		makeWelcome(clientId, []),
		headers,
	];

	return result;
}

function subscribe(
	controller: SourceController,
	args: { lastEventId: string | undefined; cookie: Record<string, string> }
) {
	const lastId = Number(args.lastEventId);
	const lastTime = Number.isNaN(lastId) || !isTimeValue(lastId) ? 0 : lastId;

	// 0. waiting -> 1. subscribed -> 2. unsubscribed
	let status = 0;
	let receiver: SourceController | undefined;

	const [message, headers] = makeInitialMessage(args.cookie, lastTime);
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

function send(message: string, cookie: Record<string, string>) {
	const clientId = fromCookieClientId(cookie);
	if (!clientId) return new ServerError('Missing Client ID', { status: 400 });

	console.log('send', message, clientId);
}

export { makeInitialMessage, send, subscribe };
