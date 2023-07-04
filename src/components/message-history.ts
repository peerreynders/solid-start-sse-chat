import { createStore, type Store } from 'solid-js/store';

import type { ChatMessage, Welcome } from '~/lib/chat';

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
}

type Core = {
	id: string | undefined;
	history: ChatMessage[];
};

function makeHistory() {
	const history = new MessageHistory();
	const [store, set] = createStore<Core>({
		id: undefined,
		history: history.shunt(),
	});

	const pair: [
		Store<Core>,
		{
			reset: (message: Welcome) => void;
			shunt: (recent: ChatMessage[] | ChatMessage) => void;
		}
	] = [
		store,
		{
			reset: ({ id, messages }) => {
				set({
					id,
					history: history.reset(messages),
				});
			},
			shunt: (recent) => set('history', history.shunt(recent)),
		},
	];

	return pair;
}

export { makeHistory };
