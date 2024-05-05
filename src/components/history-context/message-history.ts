// file: src/components/message-context/message-history.ts
import { MIN_TIMEVALUE } from '../../lib/shame';

import type { ChatMessage, Welcome } from '../../lib/chat';
import type { History } from '../../types';

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

type HistoryState = {
	id: string | undefined;
	history: MessageHistory;
	reset: (message: Welcome) => void;
	shunt: (recent: History | ChatMessage) => void;
};

export function makeHistoryState(
	revalidateClientId: () => void,
	revalidateHistory: () => void
) {
	// Backing state for the reactive store
	// Note how both `reset` and `shunt` revalidate
	// to get the `cache` to update its
	// dependents
	//
	const state: HistoryState = {
		id: undefined,
		history: new MessageHistory(),
		reset: (welcome) => {
			state.id = welcome.id;
			revalidateClientId();
			if (welcome.timestamp > MIN_TIMEVALUE) {
				state.history.reset(welcome.messages);
				revalidateHistory();
			}
		},
		shunt: (recent) => {
			state.history.shunt(recent);
			revalidateHistory();
		},
	};

	return state;
}
