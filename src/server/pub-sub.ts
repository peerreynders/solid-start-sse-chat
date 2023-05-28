// file: src/server/pub-sub.ts
import { customAlphabet } from 'nanoid';
import { SourceController } from './solid-start-sse-support';
import { makeChat, makeWelcome } from '~/lib/chat';
import { isTimeValue } from '~/lib/shame';

const makeClientId = customAlphabet('1234567890abcdef', 12);

//const msSinceStart = () => Math.trunc(performance.now());
const epochTimestamp = Date.now;

// --- BEGIN Subscriptions

const subscribers = new Set<SourceController>();
//let lastSend = 0;

function subscribe(controller: SourceController, lastEventId?: string) {
	const lastId = Number(lastEventId);
	const lastTime = Number.isNaN(lastId) || !isTimeValue(lastId) ? 0 : lastId;

	// 0. waiting -> 1. subscribed -> 2. unsubscribed
	let status = 0;
	let receiver: SourceController | undefined;
	const finalize = () => {
		if (status > 0) return;

		receiver = controller;

		// Send Welcome Message
		const messageId = epochTimestamp().toString();
		const message =
			lastTime > 0 ? makeChat([]) : makeWelcome(makeClientId(), []);

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

	return unsubscribe;
}

export { subscribe };
