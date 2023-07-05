import { suite } from 'uvub';
import * as assert from 'uvub/assert';
import { createEffect, createRoot } from 'solid-js';

// --
import { unwrap } from 'solid-js/store';

import { makeHistory } from '../../../src/components/message-context/message-history';
import { makeChat, makeWelcome, type ChatMessage } from '../../../src/lib/chat';

const BASE_TIME = 1_800_000_000_000;

type TestChats = [id: string | undefined, ...timestamp: number[]];
const fromChatMessage = (result: TestChats, message: ChatMessage) => (
	result.push(message.timestamp - BASE_TIME), result
);

type Store = ReturnType<typeof makeHistory>[0];
const fromStore = (store: Store) =>
	unwrap(store.history).reduce(fromChatMessage, [store.id]);

const makeTestChatMessage = (id: number) => ({
	timestamp: id + BASE_TIME,
	from: 'FROM',
	body: 'BODY',
});

function makeTestWelcome(client: string, ids: number[]) {
	const messages = ids.map(makeTestChatMessage);
	return makeWelcome(client, messages, messages[0].timestamp);
}

function makeTestChat(ids: number[]) {
	const messages = ids.map(makeTestChatMessage);
	return makeChat(messages, messages[0].timestamp);
}
// ---

const suiteRuns: (() => void)[] = [];

const messageHistory = suite('Message History');

// --- TESTS ---

messageHistory('Reactive setup', async () => {
	const result = await new Promise((resolve, _reject) => {
		createRoot((dispose) => {
			// Given (setup)
			const actual: TestChats[] = [];
			const [store, _handle] = makeHistory();

			createEffect(() => {
				actual.push(fromStore(store)); // [[undefined]] during setup
			});
			setTimeout(() => {
				// When (Actions)
				dispose();
				resolve(actual);
			});
		});
	});

	// Then (Result)
	const expected = [[undefined]];
	assert.equal(result, expected, `Expected: ${expected} actual: ${result}`);
});

messageHistory('Reactive reset(welcome)', async () => {
	const result = await new Promise((resolve, _reject) => {
		createRoot((dispose) => {
			// Given (setup)
			const actual: TestChats[] = [];
			const [store, handle] = makeHistory();

			createEffect(() => {
				actual.push(fromStore(store)); // [[undefined]] during setup
			});
			setTimeout(() => {
				// When (Actions)
				handle.reset(makeTestWelcome('AAA', [3, 2, 1]));
				dispose();
				resolve(actual);
			});
		});
	});

	// Then (Result)
	const expected = [[undefined], ['AAA', 3, 2, 1]];
	assert.equal(result, expected, `Expected: ${expected} actual: ${result}`);
});

messageHistory('Reactive shunt(chat)', async () => {
	const result = await new Promise((resolve, _reject) => {
		createRoot((dispose) => {
			// Given (setup)
			const actual: TestChats[] = [];
			const [store, handle] = makeHistory();

			createEffect(() => {
				actual.push(fromStore(store));
			});
			setTimeout(() => {
				// When (Actions)
				handle.shunt(makeTestChat([3, 2, 1]).messages);
				dispose();
				resolve(actual);
			});
		});
	});

	// Then (Result)
	const expected = [[undefined], [undefined, 3, 2, 1]];
	assert.equal(result, expected, `Expected: ${expected} actual: ${result}`);
});

messageHistory('Reactive reset(welcome), shunt(chat)', async () => {
	const result = await new Promise((resolve, _reject) => {
		createRoot((dispose) => {
			// Given (setup)
			const actual: TestChats[] = [];
			const [store, handle] = makeHistory();

			createEffect(() => {
				actual.push(fromStore(store));
			});
			setTimeout(() => {
				// When (Actions)
				handle.reset(makeTestWelcome('AAA', [3, 2, 1]));
				handle.shunt(makeTestChat([6, 5, 4]).messages);
				dispose();
				resolve(actual);
			});
		});
	});

	// Then (Result)
	const expected = [[undefined], ['AAA', 3, 2, 1], ['AAA', 6, 5, 4, 3, 2, 1]];
	assert.equal(result, expected, `Expected: ${expected} actual: ${result}`);
});

messageHistory(
	'Reactive reset(welcome), shunt(chat), reset(welcome)',
	async () => {
		const result = await new Promise((resolve, _reject) => {
			createRoot((dispose) => {
				// Given (setup)
				const actual: TestChats[] = [];
				const [store, handle] = makeHistory();

				createEffect(() => {
					actual.push(fromStore(store));
				});
				setTimeout(() => {
					// When (Actions)
					handle.reset(makeTestWelcome('AAA', [3, 2, 1]));
					handle.shunt(makeTestChat([6, 5, 4]).messages);
					handle.reset(makeTestWelcome('BBB', [9, 8, 7]));
					dispose();
					resolve(actual);
				});
			});
		});

		// Then (Result)
		const expected = [
			[undefined],
			['AAA', 3, 2, 1],
			['AAA', 6, 5, 4, 3, 2, 1],
			['BBB', 9, 8, 7],
		];
		assert.equal(result, expected, `Expected: ${expected} actual: ${result}`);
	}
);

// --- TESTS END ---

suiteRuns.push(messageHistory.run);

function all() {
	return suiteRuns.slice();
}

export { all };
