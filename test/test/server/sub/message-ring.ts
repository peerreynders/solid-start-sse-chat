import { suite } from 'uvub';
import * as assert from 'uvub/assert';

import {
	MessageRing,
} from '../../../../src/server/sub/message-ring';
import { makeChat, type Chat } from '../../../../src/server/chat';

const CLIENT_ID_FROM = 'theSource';

function makeMessages(count: number, oldest: number, step: number) {
	const messages: Array<Chat> = [];
	let timestamp = oldest + (count - 1) * step;
	for (let i = 0; i < count; i += 1) {
		const msg = { timestamp, from: CLIENT_ID_FROM, body: String(i)}
		messages.push(makeChat([msg], timestamp));
		timestamp -= step;
	}
	return messages;
}

const suiteRuns: (() => void)[] = [];

const messageRing = suite('Message Ring');

// --- TESTS ---
const BASE_TIME = 1_800_000_000_000;
const MIN_WAIT = 2_000;
const HISTORY_INTERVAL = 30_000;
const CLIENT_ID = 'thx1138';

messageRing('Initialized and empty. Returns keepAlive', () => {
	// Given
	const uut = new MessageRing(HISTORY_INTERVAL);

	// When
	// nothing happens

	// Then
	assert.is(uut.countAfter(BASE_TIME, BASE_TIME, MIN_WAIT), -1, 'countAfter did not recommend Welcome request (-1)')
	const message = uut.toMessage(BASE_TIME, CLIENT_ID, BASE_TIME - MIN_WAIT);
	assert.ok(message.kind === 'keep-alive', "Message returned isn't KeepAlive");
	assert.ok(message.timestamp === BASE_TIME, "KeepAlive does not have the provided timestamp");
});

messageRing('32 messages within interval. Returns all in Chat', () => {
	// GIVEN
	const uut = new MessageRing(HISTORY_INTERVAL);
	// 32 messages in under 15 seconds
	const step = 468;
	const source = makeMessages(32,BASE_TIME,step);

	// WHEN
	// add messages in sequence
	for (let i = source.length - 1; i >= 0; i -= 1) {
		const current = source[i];
		uut.push(current.timestamp, current);
	}
	// 500ms later
	const now = source[0].timestamp + 500;

	// Then
	// Getting the full count is only possible
	// once the first tail has been discarded so 
	// 31 is the maximum that can be achieved here 
	assert.is(uut.countAfter(now, BASE_TIME-1, 0), -1, 'countAfter did not recommend Welcome request (-1)');
	assert.is(uut.countAfter(now, BASE_TIME, 0), 31, 'countAfter did not match (31)a');
	assert.is(uut.countAfter(now, BASE_TIME, MIN_WAIT), 31, 'countAfter did not match (31)b');

	// ... which doesn't stop us from getting all messages
	// by gaming `lastTime`
	const message = uut.toMessage(now, CLIENT_ID, BASE_TIME - 1);
	assert.ok(message.kind === 'chat', "Message returned isn't Chat");
	assert.ok(message.timestamp === source[0].timestamp, 'Chat does not have the expected timestamp');
	assert.ok(message.kind === 'chat' && message.messages.length === source.length, "Source and messages lengths don't match");
	assert.ok(message.kind === 'chat' && message.messages.every((v,i) => v === source[i].messages[0]), "Source and messages elements don't match");
});

messageRing('64 messages within interval (requires resize). Returns all in Chat', () => {
	// GIVEN
	const uut = new MessageRing(HISTORY_INTERVAL);
	// 64 messages in under 15 seconds
	const step = 234;
	const source = makeMessages(64,BASE_TIME,step);

	// WHEN
	// add messages in sequence
	for (let i = source.length - 1; i >= 0; i -= 1) {
		const current = source[i];
		uut.push(current.timestamp, current);
	}
	// 500ms later
	const now = source[0].timestamp + 500;

	// Then
	// Getting the full count is only possible
	// once the first tail has been discarded so 
	// 63 is the maximum that can be achieved here 

	assert.is(uut.countAfter(now, BASE_TIME-1, 0), -1, 'countAfter did not recommend Welcome request (-1)');
	assert.is(uut.countAfter(now, BASE_TIME, 0), 63, 'countAfter did not match (63)a');
	assert.is(uut.countAfter(now, BASE_TIME, MIN_WAIT), 63, 'countAfter did not match (63)b');

	// ... which doesn't stop us from getting all messages
	// by gaming `lastTime`
	const message = uut.toMessage(now, CLIENT_ID, BASE_TIME - 1);
	assert.ok(message.kind === 'chat', "Message returned isn't Chat");
	assert.ok(message.timestamp === source[0].timestamp, 'Chat does not have the expected timestamp');
	assert.ok(message.kind === 'chat' && message.messages.length === source.length, "Source and messages lengths don't match");
	assert.ok(message.kind === 'chat' && message.messages.every((v,i) => v === source[i].messages[0]), "Source and messages elements don't match");

});

messageRing.only('3 sparse messages of 90 secs', () => {
	// GIVEN
	const uut = new MessageRing(HISTORY_INTERVAL);
	const step = 45000; // 45 secs apart
	let now = BASE_TIME;
	const source = makeMessages(3,BASE_TIME,step);
	let current = source[2];

	// WHEN (A)
	uut.push(current.timestamp, current);

	// THEN (A)
	// `lastTime` means "I have all events upto AND including lastTime"
	// This implies that the message held by MessageRing has already been
	// sent to the client. So a 0 count is expected
	const lastTimeA = now;
	assert.is(uut.countAfter(now, lastTimeA, 0), 0, 'countAfter should be (0)');

	// being earlier than the internal `lowerBound`
	// we have no knowledge that the client wouldn't be missing any events
	// So the recommendation is to get a Welcome message instead
	// This is an edge case as in general the internal `lowerBound`
	// should be the timestamp of the last dropped message.
	// But before any messages are dropped the `lowerBound` is just the
	// timestamp of the oldest message
	// (Before that it's MAX_TIMEVALUE to force Welcome recommendations until
	// the first message is pushed)
	assert.is(uut.countAfter(now, lastTimeA - 1, 0), -1, 'countAfter should be (-1)(A)');

	// Before the first message is purged it is impossible 
	// to get a count of all the messages in MessageRing as the last message
	// is the boundary.

	// But we can still get the message by using a `lastTime` that would 
	// result in a -1 from countAfter(lastTime,0)
	let message = uut.toMessage(now, CLIENT_ID, lastTimeA - 1);
	assert.ok(message.kind === 'chat', "Message returned isn't Chat (A)");
	assert.ok(message.timestamp === current.timestamp, 'Chat does not have the expected timestamp (A)');
	assert.ok(message.kind === 'chat' && message.messages.length === current.messages.length, "Source and messages lengths don't match (A)");
	assert.ok(message.kind === 'chat' && message.messages.every((v,i) => v === current.messages[i]), "Source and messages elements don't match (A)");

	// A `lastTime` that matches the timestamp of the only
	// message held will exclude that message resulting in a KeepAlive message
	now += 500;
	message = uut.toMessage(now, CLIENT_ID, lastTimeA);
	assert.ok(message.kind === 'keep-alive', "Message returned isn't KeepAlive (A)");
	assert.ok(message.timestamp === now, "KeepAlive does not have the provided timestamp (A)");

	// WHEN (B)
	now += 44500 // 45secs after inital message
	const lastTimeB = now - HISTORY_INTERVAL;

	// THEN (B)
	// lastTime is later than the store message so
	// - no potential of missed events (which would require a return of -1)
	// - but the are no "more recent" messages either (so return 0)
	assert.is(uut.countAfter(now, lastTimeB, 0), 0, 'countAfter should be (0) (B)');

	// so we should only get a KeepAlive
	message = uut.toMessage(now, CLIENT_ID, lastTimeB);
	assert.ok(message.kind === 'keep-alive', "Message returned isn't KeepAlive (B)");
	assert.ok(message.timestamp === now, "KeepAlive does not have the provided timestamp (B)");

	// WHEN (C)
	// deposit a fresh message
	current = source[1];
	uut.push(now, current);

	// THEN (C)
	// Now there is a fresh message. 
	// Adding it should have purged the older message 
	// but left the internal `lowerbound` intact.

	// This should still recommend requesting a Welcome
	assert.is(uut.countAfter(now, lastTimeA - 1, 0), -1, 'countAfter should be (-1) (CA)');

	// ... while this now indicates that there has been 1 message since lastTimeA
	assert.is(uut.countAfter(now, lastTimeA, 0), 1, 'countAfter should be (1) (CA)');

	// ... and that message should be the last one pushed (C) 
	message = uut.toMessage(now, CLIENT_ID, lastTimeA);
	assert.ok(message.kind === 'chat', "Message returned isn't Chat (C)");
	assert.ok(message.timestamp === current.timestamp, 'Chat does not have the expected timestamp (C)');
	assert.ok(message.kind === 'chat' && message.messages.length === current.messages.length, "Source and messages lengths don't match (C)");
	assert.ok(message.kind === 'chat' && message.messages.every((v,i) => v === current.messages[i]), "Source and messages elements don't match (C)");

	// WHEN (D)
	const lastTimeD = now;
	now += 45000 // 45secs after second message
	const lastTimeDD = now;
	// deposit a fresh message
	current = source[0];
	uut.push(now, current);
	// Internal 'lowBound' should have now changed to source[1].timestamp 
	// (was source[0].timestamp before) 
	assert.is(uut.countAfter(now, lastTimeD -1, 0), -1, 'countAfter should be (-1) (D)');
	assert.is(uut.countAfter(now, lastTimeD, 0), 1, 'countAfter should be (1) (D)');
	assert.is(uut.countAfter(now, lastTimeDD, 0), 0, 'countAfter should be (0) (D)');

	message = uut.toMessage(now, CLIENT_ID, lastTimeD);
	assert.ok(message.kind === 'chat', "Message returned isn't Chat (D)");
	assert.ok(message.timestamp === current.timestamp, 'Chat does not have the expected timestamp (D)');
	assert.ok(message.kind === 'chat' && message.messages.length === current.messages.length, "Source and messages lengths don't match (D)");
	assert.ok(message.kind === 'chat' && message.messages.every((v,i) => v === current.messages[i]), "Source and messages elements don't match (D)");

	// WHEN (E)
	// Push time to the edge of the history interval
	// but allowing for a minimum wait time.
	now += HISTORY_INTERVAL - MIN_WAIT;
	// ... without the wait the message is safe
	assert.is(uut.countAfter(now, lastTimeD, 0), 1, 'countAfter should be (1) still (E)');
	// ... however if there is a minimum wait before toMessage() the message may be gone
	assert.is(uut.countAfter(now, lastTimeD, MIN_WAIT), -1, 'countAfter should be (-1) (E)');
});

// --- TESTS END ---

suiteRuns.push(messageRing.run);

function all() {
	return suiteRuns.slice();
}

export { all };
