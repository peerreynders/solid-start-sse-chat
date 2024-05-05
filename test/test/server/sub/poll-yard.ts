// file: src/server/poll-yard.ts
import { suite } from 'uvub';
import * as assert from 'uvub/assert';

import { PollYard } from '../../../../src/server/sub/poll-yard';

const suiteRuns: (() => void)[] = [];

const pollYard = suite('Poll Yard');
function makePoll(id: string) {
	const client: {
		id: string;
		closeCount: number;
		close: () => void;
	} = {
		id,
		closeCount: 0,
		close: () => {
			++client.closeCount;
		},
	};

	return client;
}

// type TimerId = ReturnType<typeof setTimeout>;
type TimerId = number;

const KEEP_ALIVE_MS = 15000;
const LONGPOLL_MIN_WAIT = 2000;

type Link = ConstructorParameters<typeof PollYard<TimerId>>[0];
type SetTimer = Link['setTimer'];
type TimerTask = Parameters<SetTimer>[0];
type Core = Parameters<SetTimer>[2];

function makeLinkHolder(time = 0) {
	const holder: {
		nextTimerId: number;
		timerId: TimerId | undefined;
		time: number;
		nextTime: number;
		fn: TimerTask | undefined;
		arg: Core | undefined;
		runTask: () => boolean;
		link: Link;
	} = {
		nextTimerId: 9999999,
		timerId: undefined,
		time,
		nextTime: 0,
		fn: undefined,
		arg: undefined,
		runTask: () => {
			if (!holder.fn || !holder.arg) return false;

			if (holder.time < holder.nextTime) return false;

			const fn = holder.fn;
			const arg = holder.arg;

			holder.timerId = undefined;
			holder.nextTime = 0;
			holder.fn = undefined;
			holder.arg = undefined;

			fn(arg);
			return true;
		},
		link: {
			minMs: LONGPOLL_MIN_WAIT,
			maxMs: KEEP_ALIVE_MS,
			clearTimer: (id) => {
				if (id !== holder.timerId)
					throw new assert.Assertion({
						message: "Cleared timerId doesn't match",
					});

				holder.nextTime = 0;
				holder.timerId = undefined;
				holder.fn = undefined;
				holder.arg = undefined;
			},
			setTimer: (fn, delay, core) => {
				const id = holder.nextTimerId--;

				if (holder.timerId)
					throw new assert.Assertion({ message: 'timerId already taken' });

				holder.nextTime = holder.time + delay;
				holder.timerId = id;
				(holder.fn = fn), (holder.arg = core);

				return id;
			},
			timeMs: () => holder.time,
		},
	};

	return holder;
}

// --- TESTS ---

pollYard('1 poll with 1 message close after minMs', () => {
	// GIVEN
	const messageCount = 1;
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const poll = makePoll('A');

	// WHEN
	uut.add(poll.close, poll.id, messageCount);
	holder.time += 2000;
	holder.runTask();

	// THEN
	assert.is(
		poll.closeCount,
		1,
		`Poll wasn't closed after minMs (with at least 1 message)`
	);
});

pollYard('1 poll with no message close after maxMs', () => {
	// GIVEN
	const messageCount = 0;
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const poll = makePoll('A');

	// WHEN
	uut.add(poll.close, poll.id, messageCount);
	holder.time += 2000;
	holder.runTask();

	// THEN
	assert.is(poll.closeCount, 0, `Poll was closed before maxMs expired`);

	// WHEN
	holder.time += 13000;
	holder.runTask();

	// THEN
	assert.is(poll.closeCount, 1, `Poll wasn't closed after maxMs (no message)`);
});

pollYard('1 poll with 1 message unsubscribe before minMs', () => {
	// GIVEN
	const subId = 'A';
	const messageCount = 1;
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const poll = makePoll(subId);

	// WHEN
	uut.add(poll.close, poll.id, messageCount);
	holder.time += 2000;
	uut.unsubscribe(subId);
	const hasRun = holder.runTask();

	// THEN
	assert.is(
		poll.closeCount,
		0,
		`Poll was closed despite unsubscribe before minMs (1 message)`
	);
	assert.is(hasRun, false, `Unexpected timer task was run`);
});

pollYard('1 poll with no message, unsubscribe before maxMs', () => {
	// GIVEN
	const subId = 'A';
	const messageCount = 0;
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const poll = makePoll(subId);

	// WHEN
	uut.add(poll.close, poll.id, messageCount);
	holder.time += 15000;
	uut.unsubscribe(subId);
	const hasRun = holder.runTask();

	// THEN
	assert.is(
		poll.closeCount,
		0,
		`Poll was closed despite unsubscribe before maxMs (1 message)`
	);
	assert.is(hasRun, false, `Unexpected timer task was run`);
});

pollYard('1 poll, no message but mark before minMs', () => {
	// GIVEN
	const subId = 'A';
	const messageCount = 0;
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const poll = makePoll(subId);

	// WHEN
	uut.add(poll.close, poll.id, messageCount);
	holder.time += 1000;
	uut.mark(1);
	let hasRun = holder.runTask();

	// THEN
	assert.is(poll.closeCount, 0, `Poll was closed before minMs (after mark)`);
	assert.is(hasRun, false, `Unexpected timer task was run`);

	// WHEN
	holder.time += 1000;
	hasRun = holder.runTask();

	// THEN
	assert.is(poll.closeCount, 1, `Poll wasn't closed after minMs (after mark)`);
});

pollYard('1 poll, no message but mark before maxMs', () => {
	// GIVEN
	const subId = 'A';
	const messageCount = 0;
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const poll = makePoll(subId);

	// WHEN
	uut.add(poll.close, poll.id, messageCount);
	holder.time += 2000;
	let hasRun = holder.runTask();

	// THEN
	assert.is(poll.closeCount, 0, `Poll was closed at minMs (before mark)`);
	assert.is(hasRun, false, `Unexpected timer task was run`);

	// WHEN
	holder.time += 1000;
	uut.mark(1);

	// THEN
	assert.is(poll.closeCount, 1, `Poll wasn't closed after mark`);
});

pollYard('2 polls, 1 message; close each after minMs', () => {
	// GIVEN
	const messageCount = 1;
	const aId = 'A';
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const pollA = makePoll(aId);

	// WHEN
	uut.add(pollA.close, pollA.id, messageCount);
	holder.time += 1000;

	const bId = 'B';
	const pollB = makePoll(bId);
	uut.add(pollB.close, pollB.id, messageCount);
	let hasRun = holder.runTask();

	// THEN
	assert.is(pollA.closeCount, 0, `Poll A was unexpectedly closed`);
	assert.is(pollB.closeCount, 0, `Poll B was unexpectedly closed (A)`);
	assert.is(hasRun, false, `Unexpected timer task was run`);

	// WHEN
	holder.time += 1000;
	hasRun = holder.runTask();

	// THEN
	assert.is(
		pollA.closeCount,
		1,
		`Poll A wasn't closed after minMs (1 message)`
	);
	assert.is(pollB.closeCount, 0, `Poll B was unexpectedly closed (B)`);

	// WHEN
	holder.time += 1000;
	hasRun = holder.runTask();

	assert.is(pollA.closeCount, 1, `Poll A was unexpectedly closed again`);
	assert.is(
		pollB.closeCount,
		1,
		`Poll B wasn't closed after minMs (1 message)`
	);
});

pollYard('2 polls, no message; mark before minMs', () => {
	// GIVEN
	const messageCount = 0;
	const aId = 'A';
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const pollA = makePoll(aId);

	// WHEN
	uut.add(pollA.close, pollA.id, messageCount);
	holder.time += 1000;

	const bId = 'B';
	const pollB = makePoll(bId);
	uut.add(pollB.close, pollB.id, messageCount);
	let hasRun = holder.runTask();

	// THEN
	assert.is(pollA.closeCount, 0, `Poll A was unexpectedly closed`);
	assert.is(pollB.closeCount, 0, `Poll B was unexpectedly closed (A)`);
	assert.is(hasRun, false, `Unexpected timer task was run`);

	// WHEN
	holder.time += 500;
	uut.mark(1);

	// THEN
	assert.is(pollA.closeCount, 0, `Poll A was unexpectedly closed (B)`);
	assert.is(pollB.closeCount, 0, `Poll B was unexpectedly closed (B)`);

	// WHEN
	holder.time += 500;
	hasRun = holder.runTask();

	// THEN
	assert.is(
		pollA.closeCount,
		1,
		`Poll A wasn't closed after minMs (after mark)`
	);
	assert.is(pollB.closeCount, 0, `Poll B was unexpectedly closed (C)`);

	// WHEN
	holder.time += 1000;
	hasRun = holder.runTask();

	assert.is(pollA.closeCount, 1, `Poll A was unexpectedly closed again`);
	assert.is(
		pollB.closeCount,
		1,
		`Poll B wasn't closed after minMs (after mark)`
	);
});

pollYard('2 polls, close each before maxMs', () => {
	// GIVEN
	const messageCount = 0;
	const aId = 'A';
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const pollA = makePoll(aId);

	// WHEN
	uut.add(pollA.close, pollA.id, messageCount);
	holder.time += 8000;

	const bId = 'B';
	const pollB = makePoll(bId);
	uut.add(pollB.close, pollB.id, messageCount);
	let hasRun = holder.runTask();

	// THEN
	assert.is(pollA.closeCount, 0, `Poll A was unexpectedly closed`);
	assert.is(pollB.closeCount, 0, `Poll B was unexpectedly closed (A)`);
	assert.is(hasRun, false, `Unexpected timer task was run`);

	// WHEN
	holder.time += 7000;
	hasRun = holder.runTask();

	// THEN
	assert.is(pollA.closeCount, 1, `Poll A wasn't closed after maxMs`);
	assert.is(pollB.closeCount, 0, `Poll B was unexpectedly closed (C)`);

	// WHEN
	holder.time += 8000;
	hasRun = holder.runTask();

	assert.is(pollA.closeCount, 1, `Poll A was unexpectedly closed again`);
	assert.is(pollB.closeCount, 1, `Poll B wasn't closed after maxMs`);
});

pollYard('Later poll with outstanding message closes earlier', () => {
	// GIVEN
	const aId = 'A';
	const holder = makeLinkHolder(1000);
	const uut = new PollYard(holder.link);
	const pollA = makePoll(aId);

	// WHEN
	uut.add(pollA.close, pollA.id, 0);
	holder.time += 8000;

	const bId = 'B';
	const pollB = makePoll(bId);
	uut.add(pollB.close, pollB.id, 1);
	let hasRun = holder.runTask();

	// THEN
	assert.is(pollA.closeCount, 0, `Poll A was unexpectedly closed (A)`);
	assert.is(pollB.closeCount, 0, `Poll B was unexpectedly closed (A)`);
	assert.is(hasRun, false, `Unexpected timer task was run`);

	// WHEN
	holder.time += 2000;
	hasRun = holder.runTask();

	// THEN
	assert.is(pollA.closeCount, 0, `Poll A was unexpectedly closed (A)`);
	assert.is(
		pollB.closeCount,
		1,
		`Poll B wasn't closed after minMs (1 message)`
	);

	// WHEN
	holder.time += 5000;
	hasRun = holder.runTask();

	assert.is(pollA.closeCount, 1, `Poll A wasn't closed after maxMs`);
	assert.is(pollB.closeCount, 1, `Poll B was unexpectedly closed again`);
});

// --- TESTS END ---

suiteRuns.push(pollYard.run);

function all() {
	return suiteRuns.slice();
}

export { all };
