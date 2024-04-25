// file: src/components/message-context/message-history.ts
import { cache, revalidate } from '@solidjs/router';
import { MIN_TIMEVALUE } from '~/lib/shame';

import type { ChatMessage, Welcome } from '../../lib/chat';

const NAME_HISTORY = 'message-history';
const NAME_CLIENT_ID = 'client-id';

// The MessageHistory class manages two
// alternating buffers in `pool`.
// The changing array references let the
// wrapping store know that the array
// content changed.
//
// `reset` fills the unused buffer with the
// passed `messages` and returns it after it
// truncates the previous buffer.
//
// `shunt` fills the unused buffer with the passed message(s)
// and then copies the messages from the previous buffer.
// The previous buffer is truncated before the patched
// buffer is returned.
//
class MessageHistory {
	currentIndex = 0;
	pool: [ChatMessage[], ChatMessage[]] = [[], []];

	reset(messages: ChatMessage[]) {
		// fill unused buffer with passed messages.
		const next = 1 - this.currentIndex;
		const history = this.pool[next];
		history.splice(0, Infinity, ...messages);

		// clear current buffer and swap
		this.pool[this.currentIndex].length = 0;
		this.currentIndex = next;
		return history;
	}

	shunt(message?: ChatMessage[] | ChatMessage) {
		if (!message) return this.pool[this.currentIndex];

		// Fill target with most recent messages
		const next = 1 - this.currentIndex;
		const history = this.pool[next];
		if (Array.isArray(message)) {
			for (let i = 0; i < message.length; i += 1) history[i] = message[i];
		} else {
			history[0] = message;
		}

		// Now fill with older messages
		const offset = history.length;
		const older = this.pool[this.currentIndex];
		for (let i = 0; i < older.length; i += 1) history[i + offset] = older[i];

		// clear current buffer and swap
		this.pool[this.currentIndex].length = 0;
		this.currentIndex = next;
		return history;
	}

	get value() {
		// Note defensive copy
		return this.pool[this.currentIndex].slice();
	}
}

type History = Array<ChatMessage>;

type HistoryReturn = [
	{
		messages: () => Promise<History>;
		clientId: () => Promise<string | undefined>;
	},
	{
		reset: (message: Welcome) => void;
		shunt: (recent: ChatMessage[] | ChatMessage) => void;
	},
];

// makes a `[store, mutators]` pair for the message history
// The store exposes the client ID `id` and an array of messages
// in `history` to be used by the UI.
//
// The `reset` mutator sets the client ID and message history
// from the `Welcome` message.
// The history is ignored `welcome.timestamp === MIN_TIMEVALUE`
//
// The `shunt` mutator add the messages at the head of the
// history array.
function makeHistoryCSR(): HistoryReturn {
	// Backing state for the reactive store
	// Note how both `reset` and `shunt` revalidate
	// to get the `cache` to update its
	// dependents
	//
	const state: {
		id: string | undefined;
		history: MessageHistory;
		reset: (message: Welcome) => void;
		shunt: (recent: ChatMessage[] | ChatMessage) => void;
	} = {
		id: undefined,
		history: new MessageHistory(),
		reset: (welcome: Welcome) => {
			state.id = welcome.id;
			revalidate(NAME_CLIENT_ID, true);
			if (welcome.timestamp > MIN_TIMEVALUE) {
				state.history.reset(welcome.messages);
				revalidate(NAME_HISTORY, true);
			}
		},
		shunt: (recent) => {
			state.history.shunt(recent);
			revalidate(NAME_HISTORY, true);
		},
	};

	// Create a `cache` to attach a
	// `createAsyncStore` to
	const getMessages = cache(() => {
		console.log('getMessages', Date.now());
		return Promise.resolve(state.history.value);
	}, NAME_HISTORY);

	// Create a `cache` to attach a
	// `createAsync` to
	const getClientId = cache(() => {
		console.log('getClientId', Date.now());
		return Promise.resolve(state.id);
	}, NAME_CLIENT_ID);

	return [
		{
			messages: () => getMessages(),
			clientId: () => getClientId(),
		},
		{
			reset: state.reset,
			shunt: state.shunt,
		},
	];
}

// The SSR version is only loaded once from the initial
// welcome message. The mutators are no-ops.
function makeHistorySSR(welcome: Promise<Welcome>): HistoryReturn {
	const idFrom = (welcome: Welcome) => welcome.id;
	const messagesFrom = (welcome: Welcome) => welcome.messages;

	return [
		{
			messages: () => welcome.then(messagesFrom),
			clientId: () => welcome.then(idFrom),
		},
		{
			reset: (_welcome) => void 0,
			shunt: (_recent) => void 0,
		},
	];
}

export const makeHistory = (welcome?: Promise<Welcome>) =>
	welcome ? makeHistorySSR(welcome) : makeHistoryCSR();
