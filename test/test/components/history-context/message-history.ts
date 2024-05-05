import { suite } from 'uvub';
import * as assert from 'uvub/assert';
import {
	batch,
	createEffect,
	createResource,
	createRoot,
	untrack,
} from 'solid-js';

// ---
import { createStore, reconcile, unwrap } from 'solid-js/store';

import { makeHistoryState } from '../../../../src/components/history-context/message-history';
import { makeChat, makeWelcome } from '../../../../src/server/chat';

import type { Resource, Signal } from 'solid-js';
import type { History } from '../../../../src/types';
import type { ChatMessage, Welcome } from '../../../../src/lib/chat';

const BASE_TIME = 1_800_000_000_000;

type Access = {
	clientId: Resource<string | undefined>;
	messages: Resource<History>;
};

type Wrapped = [
	Access,
	{
		reset: (message: Welcome) => void;
		shunt: (recent: History | ChatMessage) => void;
	},
];

type H = History | undefined;
function createHistorySignal(value: H): Signal<H> {
	const [store, setStore] = createStore({
		value,
	});
	const opts = { key: 'timestamp', merge: true };

	return [
		() => store.value,
		(v: H | ((previous: H) => H)) => {
			const unwrapped = unwrap(store.value);
			typeof v === 'function' && (v = v(unwrapped));
			setStore('value', reconcile(v, opts));
			return store.value;
		},
	] as Signal<H>;
}

// Wrap HistoryState in a way that reflects it's intended use
function wrapped(): Wrapped {
	let revalidateClientId: (() => void) | undefined;
	let revalidateHistory: (() => void) | undefined;
	// create state before reactive primitive
	const state = makeHistoryState(
		() => revalidateClientId?.(),
		() => revalidateHistory?.()
	);

	const [clientId, { refetch: refetchClientId }] = createResource(() => {
		return state.id;
	});
	revalidateClientId = refetchClientId;

	const [messages, { refetch: refetchHistory }] = createResource<History>(
		() => {
			return state.history.value;
		},
		{ storage: createHistorySignal }
	);
	revalidateHistory = refetchHistory;

	return [
		{
			clientId,
			messages,
		},
		{
			reset: (message) => batch(() => state.reset(message)),
			shunt: state.shunt,
		},
	];
}

type TestChats = [id: string | undefined, ...timestamp: number[]];
const fromChatMessage = (result: TestChats, message: ChatMessage) => (
	result.push(message.timestamp - BASE_TIME), result
);

const fromAccess = (access: Access) => {
	const initial: TestChats = [access.clientId()];
	const messages = access.messages();
	const testChats = messages
		? messages.reduce(fromChatMessage, initial)
		: initial;
	console.log('fromAccess', testChats);
	return testChats;
};

const makeTestChatMessage = (id: number) => ({
	timestamp: id + BASE_TIME,
	from: 'FROM',
	body: 'BODY',
});

function makeTestWelcome(client: string, ids: number[]) {
	const messages = ids.map(makeTestChatMessage);
	return makeWelcome(messages, messages[0].timestamp, client);
}

function makeTestChat(ids: number[]) {
	const messages = ids.map(makeTestChatMessage);
	return makeChat(messages, messages[0].timestamp);
}

/*
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
*/
// ---

const suiteRuns: (() => void)[] = [];

const messageHistory = suite('Message History');

// --- TESTS ---

messageHistory('Reactive setup', async () => {
	const result = await new Promise((resolve, _reject) => {
		createRoot((dispose) => {
			// Given (setup)
			const actual: TestChats[] = [];
			const [access, _handle] = wrapped();

			createEffect(() => {
				actual.push(fromAccess(access)); // [[undefined]] during setup
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
			const [access, handle] = wrapped();

			createEffect(() => {
				actual.push(fromAccess(access)); // [[undefined]] during setup;
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
			const [access, handle] = wrapped();

			createEffect(() => {
				actual.push(fromAccess(access)); // [[undefined]] during setup;
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
			const [access, handle] = wrapped();

			createEffect(() => {
				actual.push(fromAccess(access)); // [[undefined]] during setup;
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
				const [access, handle] = wrapped();

				createEffect(() => {
					actual.push(fromAccess(access)); // [[undefined]] during setup;
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
