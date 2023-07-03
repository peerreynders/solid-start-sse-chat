import { suite } from 'uvub';
import * as assert from 'uvub/assert';

import {
	Streamer,
	STREAMER_CHANGE,
	type Link,
} from '../../src/server/streamer';

const suiteRuns: (() => void)[] = [];

const streamer = suite('Streamer');

function makeClient(clientId: string | undefined) {
	const client: {
		id: string | undefined;
		data: string | undefined;
		dataId: string | undefined;
		send: (data: string, id?: string) => void;
	} = {
		id: clientId,
		data: undefined,
		dataId: undefined,
		send: (data: string, id?: string) => {
			client.data = data;
			client.dataId = id;
		},
	};

	return client;
}

function makeLinkHolder(time = 0) {
	const holder: {
		time: number;
		epochTime: number;
		lastChange: number | undefined;
		nextClientId: number;
		nextTimerId: number;
		timerId: number;
		add: (() => void) | undefined;
		runAdd: () => void;
		sendChat: (streamer: Streamer) => void;
		sendKeepAlive: (streamer: Streamer) => void;
		link: Link;
	} = {
		time,
		get epochTime() {
			return holder.time + 1_800_000_000_000;
		},
		lastChange: undefined,
		nextClientId: 9999999,
		nextTimerId: 9999999,
		timerId: 0,
		add: undefined,
		runAdd: () => {
			if (!holder.add)
				throw new assert.Assertion({ message: 'No add function to run' });

			const add = holder.add;

			holder.timerId = 0;
			holder.add = undefined;

			add();
		},
		sendChat: (streamer) => {
			const id = String(holder.epochTime);
			streamer.send(`chat,${id}`, id);
		},
		sendKeepAlive: (streamer) => {
			const id = String(holder.epochTime);
			streamer.send(`keep-alive,${id}`, id);
		},
		link: {
			newClientIdHeaders: () => {
				const id = String(holder.nextClientId--);
				return [id, { 'set-cookie': id }];
			},

			clearTimer: (id: number) => {
				if (id !== holder.timerId)
					throw new assert.Assertion({
						message: "Cleared timerId doesn't match",
					});

				holder.timerId = 0;
				holder.add = undefined;
			},

			schedule: (add, core, receiver) => {
				const id = holder.nextTimerId--;

				if (holder.timerId)
					throw new assert.Assertion({ message: 'timerId already taken' });

				holder.timerId = id;
				holder.add = () => add(core, receiver);

				return id;
			},

			sendInitialMessage: (send, clientId, lastTime = 0) => {
				const id = String(holder.epochTime);
				const message =
					lastTime > 0 ? `chat,${lastTime},${id}` : `welcome,${clientId},${id}`;
				send(message, id);
			},

			onChange: (kind) => (holder.lastChange = kind),
		},
	};

	return holder;
}

// --- TESTS ---

streamer('One client without ID and lastTime life cycle', () => {
	// Given
	const lastTime = undefined; // This triggers the "welcome"
	const holder = makeLinkHolder(1000);
	const uut = new Streamer(holder.link);
	const client = makeClient(undefined); // This triggers additional header

	// When
	const result = uut.add(client.send, client.id, lastTime);

	// Then
	assert.equal(
		result.headers,
		{ 'set-cookie': '9999999' },
		'Missing client header'
	);
	assert.type(result.unregister, 'function', 'missing unregister function');

	holder.time += 10;
	holder.runAdd();

	assert.is(
		client.data,
		'welcome,9999999,1800000001010',
		'Welcome message was not dispatched'
	);
	assert.is(
		client.dataId,
		'1800000001010',
		'Welcome message was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.running,
		'onChange was not (or incorrectly) called after first welcome'
	);

	holder.lastChange = -1;
	holder.time += 1990;
	holder.sendChat(uut);

	assert.is(
		client.data,
		'chat,1800000003000',
		'Chat message was not dispatched'
	);
	assert.is(
		client.dataId,
		'1800000003000',
		'Chat message was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after chat'
	);

	holder.lastChange = -1;
	holder.time += 15000;
	holder.sendKeepAlive(uut);

	assert.is(
		client.data,
		'keep-alive,1800000018000',
		'Keep alive message was not dispatched'
	);
	assert.is(
		client.dataId,
		'1800000018000',
		'Keep alive message was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after keep alive'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	result.unregister();

	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.idle,
		'onChange was not (or incorrectly) called after unregister'
	);
});

streamer('One client with ID without lastTime', () => {
	// Given
	const lastTime = undefined; // This triggers the "welcome"
	const holder = makeLinkHolder(1000);
	const uut = new Streamer(holder.link);
	const client = makeClient('AAAAAAA'); // No header needed

	// When
	const result = uut.add(client.send, client.id, lastTime);

	// Then - Note: No headers
	assert.type(result.headers, 'undefined', 'unexpected client header');
	assert.type(result.unregister, 'function', 'missing unregister function');

	holder.time += 10;
	holder.runAdd();

	assert.is(
		client.data,
		'welcome,AAAAAAA,1800000001010',
		'Welcome message was not dispatched'
	);
	assert.is(
		client.dataId,
		'1800000001010',
		'Welcome message was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.running,
		'onChange was not (or incorrectly) called after first welcome'
	);

	holder.lastChange = -1;
	holder.time += 4990;
	result.unregister();

	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.idle,
		'onChange was not (or incorrectly) called after unregister'
	);
});

streamer('One client with ID and lastTime (reconnect)', () => {
	// Given
	const holder = makeLinkHolder(1000);
	const lastTime = holder.epochTime - 20000; // No "welcome" required
	const uut = new Streamer(holder.link);
	const client = makeClient('AAAAAAA'); // No header needed

	// When
	const result = uut.add(client.send, client.id, lastTime);

	// Then
	assert.type(result.headers, 'undefined', 'unexpected client header');
	assert.type(result.unregister, 'function', 'missing unregister function');

	holder.time += 10;
	holder.runAdd();

	assert.is(
		client.data,
		'chat,1799999981000,1800000001010',
		'Chat message was not dispatched'
	);
	assert.is(
		client.dataId,
		'1800000001010',
		'Chat message was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.running,
		'onChange was not (or incorrectly) called after initial Chat'
	);

	holder.lastChange = -1;
	holder.time += 4990;
	result.unregister();

	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.idle,
		'onChange was not (or incorrectly) called after unregister'
	);
});

streamer('One client, early unregistering', () => {
	// Given
	const holder = makeLinkHolder(1000);
	const lastTime = undefined;
	const uut = new Streamer(holder.link);
	const client = makeClient(undefined);

	// When
	const result = uut.add(client.send, client.id, lastTime);

	// Then
	assert.equal(
		result.headers,
		{ 'set-cookie': '9999999' },
		'Missing client header'
	);
	assert.type(result.unregister, 'function', 'missing unregister function');

	holder.lastChange = -1;
	holder.time += 10;
	result.unregister();

	assert.type(holder.add, 'undefined', 'add task not cleared');
	assert.is(holder.timerId, 0, 'Add task timer not cleared');
	assert.is(holder.lastChange, -1, 'onChange was unexpectedly invoked');
});

function all() {
	return suiteRuns.slice();
}

streamer('Two concurrent clients life cycle', () => {
	// Given
	const lastTime = undefined; // This triggers the "welcome"
	const holder = makeLinkHolder(1000);
	const uut = new Streamer(holder.link);
	const client1 = makeClient(undefined); // This triggers additional header

	// When
	const result1 = uut.add(client1.send, client1.id, lastTime);

	// Then
	assert.equal(
		result1.headers,
		{ 'set-cookie': '9999999' },
		'Missing client header'
	);
	assert.type(result1.unregister, 'function', 'missing unregister function');

	holder.time += 10;
	holder.runAdd();

	assert.is(
		client1.data,
		'welcome,9999999,1800000001010',
		'Welcome message was not dispatched'
	);
	assert.is(
		client1.dataId,
		'1800000001010',
		'Welcome message was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.running,
		'onChange was not (or incorrectly) called after first welcome'
	);

	holder.lastChange = -1;
	holder.time += 1990;
	holder.sendChat(uut);

	assert.is(
		client1.data,
		'chat,1800000003000',
		'Chat message was not dispatched'
	);
	assert.is(
		client1.dataId,
		'1800000003000',
		'Chat message was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after chat'
	);

	holder.time += 1000;
	const client2 = makeClient(undefined);
	const result2 = uut.add(client2.send, client2.id, lastTime);

	assert.equal(
		result2.headers,
		{ 'set-cookie': '9999998' },
		'Missing client 2 header'
	);
	assert.type(result2.unregister, 'function', 'missing unregister 2 function');

	holder.lastChange = -1;
	holder.time += 20;
	holder.runAdd();

	assert.is(
		client2.data,
		'welcome,9999998,1800000004020',
		'Welcome message was not dispatched'
	);
	assert.is(
		client2.dataId,
		'1800000004020',
		'Welcome message was not supplied with event id'
	);
	assert.is(holder.lastChange, -1, 'onChange was unexpectedly invoked');

	holder.lastChange = -1;
	holder.time += 980;
	holder.sendChat(uut);

	assert.is(
		client1.data,
		'chat,1800000005000',
		'Chat message 2 1 was not dispatched'
	);
	assert.is(
		client1.dataId,
		'1800000005000',
		'Chat message 2 1 was not supplied with event id'
	);
	assert.is(
		client2.data,
		'chat,1800000005000',
		'Chat message 2 2 was not dispatched'
	);
	assert.is(
		client2.dataId,
		'1800000005000',
		'Chat message 2 2 was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after chat'
	);

	holder.lastChange = -1;
	holder.time += 15000;
	holder.sendKeepAlive(uut);

	assert.is(
		client1.data,
		'keep-alive,1800000020000',
		'Keep alive 1 1 message was not dispatched'
	);
	assert.is(
		client1.dataId,
		'1800000020000',
		'Keep alive message 1 1 was not supplied with event id'
	);
	assert.is(
		client2.data,
		'keep-alive,1800000020000',
		'Keep alive 1 2 message was not dispatched'
	);
	assert.is(
		client2.dataId,
		'1800000020000',
		'Keep alive message 1 2 was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after keep alive'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	result1.unregister();

	assert.is(
		holder.lastChange,
		-1,
		'onChange was unexpectedly called after unregister 1'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	holder.sendChat(uut);

	assert.is(
		client1.data,
		'keep-alive,1800000020000',
		'Chat message 3 1 was unexpectedly received'
	);
	assert.is(
		client1.dataId,
		'1800000020000',
		'Chat message 3 1 was unexpectedly received'
	);
	assert.is(
		client2.data,
		'chat,1800000030000',
		'Chat message 3 2 was not dispatched'
	);
	assert.is(
		client2.dataId,
		'1800000030000',
		'Chat message 3 2 was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after chat'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	result2.unregister();

	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.idle,
		'onChange was not (or incorrectly) called after unregister'
	);

	holder.lastChange = -1;
	holder.time += 15000;
	holder.sendKeepAlive(uut);

	assert.is(
		client1.data,
		'keep-alive,1800000020000',
		'Keep alive message 2 1 was unexpectedly received'
	);
	assert.is(
		client1.dataId,
		'1800000020000',
		'Keep alive message 2 1 was unexpectedly received'
	);
	assert.is(
		client2.data,
		'chat,1800000030000',
		'Keep alive message 2 2 was unexpectedly received'
	);
	assert.is(
		client2.dataId,
		'1800000030000',
		'Keep alive message 2 2 was unexpectedly received'
	);
	assert.is(holder.lastChange, -1, 'onChange was unexpectedly called');
});

streamer('Two consecutive clients life cycle', () => {
	// Given
	const lastTime = undefined; // This triggers the "welcome"
	const holder = makeLinkHolder(1000);
	const uut = new Streamer(holder.link);
	const client1 = makeClient(undefined); // This triggers additional header

	// When
	const result1 = uut.add(client1.send, client1.id, lastTime);

	// Then
	assert.equal(
		result1.headers,
		{ 'set-cookie': '9999999' },
		'Missing client header'
	);
	assert.type(result1.unregister, 'function', 'missing unregister function');

	holder.time += 10;
	holder.runAdd();

	assert.is(
		client1.data,
		'welcome,9999999,1800000001010',
		'Welcome message was not dispatched'
	);
	assert.is(
		client1.dataId,
		'1800000001010',
		'Welcome message was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.running,
		'onChange was not (or incorrectly) called after first welcome'
	);

	holder.lastChange = -1;
	holder.time += 1990;
	holder.sendChat(uut);

	assert.is(
		client1.data,
		'chat,1800000003000',
		'Chat message was not dispatched'
	);
	assert.is(
		client1.dataId,
		'1800000003000',
		'Chat message was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after chat'
	);

	holder.lastChange = -1;
	holder.time += 15000;
	holder.sendKeepAlive(uut);

	assert.is(
		client1.data,
		'keep-alive,1800000018000',
		'Keep alive 1 1 message was not dispatched'
	);
	assert.is(
		client1.dataId,
		'1800000018000',
		'Keep alive message 1 1 was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after keep alive'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	result1.unregister();

	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.idle,
		'onChange was not (or incorrectly) called after unregister'
	);

	holder.lastChange = -1;
	holder.time += 15000;
	holder.sendKeepAlive(uut);

	assert.is(
		client1.data,
		'keep-alive,1800000018000',
		'Keep alive message 2 1 was unexpectedly received'
	);
	assert.is(
		client1.dataId,
		'1800000018000',
		'Keep alive message 2 1 was unexpectedly received'
	);
	assert.is(holder.lastChange, -1, 'onChange was unexpectedly called');

	holder.time += 1980;

	const client2 = makeClient(undefined);
	const result2 = uut.add(client2.send, client2.id, lastTime);

	assert.equal(
		result2.headers,
		{ 'set-cookie': '9999998' },
		'Missing client 2 header'
	);
	assert.type(result2.unregister, 'function', 'missing unregister 2 function');

	holder.lastChange = -1;
	holder.time += 20;
	holder.runAdd();

	assert.is(
		client1.data,
		'keep-alive,1800000018000',
		'Welcome message 2 1 was unexpectedly received'
	);
	assert.is(
		client1.dataId,
		'1800000018000',
		'Welcome message 2 1 was unexpectedly received'
	);
	assert.is(
		client2.data,
		'welcome,9999998,1800000040000',
		'Welcome message 2 2 was not dispatched'
	);
	assert.is(
		client2.dataId,
		'1800000040000',
		'Welcome message 2 2 was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.running,
		'onChange 2 2 was not (or incorrectly) called after first welcome'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	holder.sendChat(uut);

	assert.is(
		client1.data,
		'keep-alive,1800000018000',
		'Chat message 2 1 was unexpectedly received'
	);
	assert.is(
		client1.dataId,
		'1800000018000',
		'Chat message 2 1 was unexpectedly received'
	);
	assert.is(
		client2.data,
		'chat,1800000045000',
		'Chat message 2 2 was not dispatched'
	);
	assert.is(
		client2.dataId,
		'1800000045000',
		'Chat message 2 2 was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange 3 2 was not (or incorrectly) called after chat'
	);

	holder.lastChange = -1;
	holder.time += 15000;
	holder.sendKeepAlive(uut);

	assert.is(
		client1.data,
		'keep-alive,1800000018000',
		'Keep alive message 3 1 was unexpectedly received'
	);
	assert.is(
		client1.dataId,
		'1800000018000',
		'Keep alive message 3 1 was unexpectedly received'
	);
	assert.is(
		client2.data,
		'keep-alive,1800000060000',
		'Keep alive 3 1 message was not dispatched'
	);
	assert.is(
		client2.dataId,
		'1800000060000',
		'Keep alive message 3 1 was not supplied with event id'
	);
	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.messageSent,
		'onChange 4 2 was not (or incorrectly) called after keep alive'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	result2.unregister();

	assert.is(
		holder.lastChange,
		STREAMER_CHANGE.idle,
		'onChange 5 2 was not (or incorrectly) called after unregister'
	);

	holder.lastChange = -1;
	holder.time += 15000;
	holder.sendKeepAlive(uut);

	assert.is(
		client1.data,
		'keep-alive,1800000018000',
		'Keep alive message 4 1 was unexpectedly received'
	);
	assert.is(
		client1.dataId,
		'1800000018000',
		'Keep alive message 4 1 was unexpectedly received'
	);
	assert.is(
		client2.data,
		'keep-alive,1800000060000',
		'Keep alive message 4 2 was unexpectedly received'
	);
	assert.is(
		client2.dataId,
		'1800000060000',
		'Keep alive message 4 2 was unexpectedly received'
	);
	assert.is(holder.lastChange, -1, 'onChange 6 2 was unexpectedly called');
});

// --- TESTS END ---

suiteRuns.push(streamer.run);

export { all };
