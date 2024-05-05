// file: src/server/stream-yard.ts
import { suite } from 'uvub';
import * as assert from 'uvub/assert';

import {
	StreamYard,
	STREAM_YARD_CHANGE,
	type Link,
} from '../../../../src/server/sub/stream-yard';

const suiteRuns: (() => void)[] = [];

const streamYard = suite('Stream Yard');

function makeClient(clientId: string) {
	const client: {
		id: string;
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
		sendChat: (yard: StreamYard) => void;
		sendKeepAlive: (yard: StreamYard) => void;
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
		sendChat: (yard) => {
			const id = String(holder.epochTime);
			yard.send(`chat,${id}`, id);
		},
		sendKeepAlive: (yard) => {
			const id = String(holder.epochTime);
			yard.send(`keep-alive,${id}`, id);
		},
		link: {
			onChange: (kind) => (holder.lastChange = kind),
		},
	};

	return holder;
}

// --- TESTS ---

streamYard('One client add/unsubscribe', () => {
	// Given
	const holder = makeLinkHolder(1000);
	const uut = new StreamYard(holder.link);
	const client = makeClient('AAAAAAA');

	// When
	uut.add(client.send, client.id);

	// Then
	holder.time += 5000;
	uut.unsubscribe(client.id);

	assert.is(
		holder.lastChange,
		STREAM_YARD_CHANGE.idle,
		'onChange was not (or incorrectly) called after unsubscribe'
	);
});

streamYard('One client add/keepAlive/unsubscribe', () => {
	// Given
	const holder = makeLinkHolder(1000);
	const uut = new StreamYard(holder.link);
	const client = makeClient('AAAAAAA');

	// When
	uut.add(client.send, client.id);

	// Then
	holder.time += 2000;
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
		STREAM_YARD_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after chat'
	);

	holder.lastChange = undefined;
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
		STREAM_YARD_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after keep alive'
	);

	holder.lastChange = undefined;
	holder.time += 5000;
	uut.unsubscribe(client.id);

	assert.is(
		holder.lastChange,
		STREAM_YARD_CHANGE.idle,
		'onChange was not (or incorrectly) called after unsubscribe'
	);
});

streamYard('Two concurrent clients life cycle', () => {
	// Given
	const holder = makeLinkHolder(1000);
	const uut = new StreamYard(holder.link);
	const client1 = makeClient('AAAAAAA'); // This triggers additional header

	// When
	uut.add(client1.send, client1.id);

	// Then
	holder.time += 2000;
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
		STREAM_YARD_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after chat'
	);

	holder.time += 1000;
	const client2 = makeClient('BBBBBBB');
	uut.add(client2.send, client2.id);

	holder.lastChange = undefined;
	holder.time += 1000;
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
		STREAM_YARD_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after chat'
	);

	holder.lastChange = undefined;
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
		STREAM_YARD_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after keep alive'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	uut.unsubscribe(client1.id);

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
		STREAM_YARD_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after chat'
	);

	holder.lastChange = undefined;
	holder.time += 5000;
	uut.unsubscribe(client2.id);

	assert.is(
		holder.lastChange,
		STREAM_YARD_CHANGE.idle,
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

streamYard('Two consecutive clients life cycle', () => {
	// Given
	const holder = makeLinkHolder(1000);
	const uut = new StreamYard(holder.link);
	const client1 = makeClient('AAAAAAA'); // This triggers additional header

	// When
	uut.add(client1.send, client1.id);

	// Then
	holder.time += 2000;
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
		STREAM_YARD_CHANGE.messageSent,
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
		STREAM_YARD_CHANGE.messageSent,
		'onChange was not (or incorrectly) called after keep alive'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	uut.unsubscribe(client1.id);

	assert.is(
		holder.lastChange,
		STREAM_YARD_CHANGE.idle,
		'onChange was not (or incorrectly) called after unsubscribe'
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

	const client2 = makeClient('BBBBBBB');
	uut.add(client2.send, client2.id);

	holder.lastChange = -1;
	holder.time += 7000;
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
		STREAM_YARD_CHANGE.messageSent,
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
		STREAM_YARD_CHANGE.messageSent,
		'onChange 4 2 was not (or incorrectly) called after keep alive'
	);

	holder.lastChange = -1;
	holder.time += 5000;
	uut.unsubscribe(client2.id);

	assert.is(
		holder.lastChange,
		STREAM_YARD_CHANGE.idle,
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

suiteRuns.push(streamYard.run);

function all() {
	return suiteRuns.slice();
}

export { all };
