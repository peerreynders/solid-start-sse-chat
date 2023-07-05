import { suite } from 'uvub';
import * as assert from 'uvub/assert';

import {
	Longpoller,
	type Link,
} from '../../../src/components/message-context/longpoller';

type TimerId = ReturnType<typeof setTimeout>;

function withSettle<T extends Error>(value: boolean | T) {
	let fn: (() => void) | undefined;
	const settle = () => {
		if (!fn) return;

		return new Promise<void>((resolve) => {
			fn?.();
			setTimeout(resolve);
		});
	};

	const p = new Promise(
		(resolve: (value: boolean) => void, reject: (reason: T) => void) => {
			fn =
				typeof value === 'boolean' ? () => resolve(value) : () => reject(value);
		}
	);
	const pair: [Promise<boolean>, () => void] = [p, settle];
	return pair;
}

function makeLinkHolder(time = 0) {
	const holder: {
		time: number;
		nextTimerId: number;
		timerId: TimerId;
		nextTime: number;
		delayMs: number;
		fn: Parameters<Link['schedule']>[0] | undefined;
		arg: Parameters<Link['schedule']>[2] | undefined;
		fetchDo: boolean | undefined;
		fetchHref: string | undefined;
		fetchSettle: (() => void | Promise<void>) | undefined;
		abortCount: number;
		failedCount: 0;
		stopKeepAliveCount: 0;
		runTask: () => void;
		link: Link;
	} = {
		time,
		nextTimerId: 9999999,
		timerId: 0,
		nextTime: 0,
		delayMs: -1,
		fn: undefined,
		arg: undefined,
		fetchDo: true,
		fetchHref: undefined,
		fetchSettle: undefined,
		abortCount: 0,
		failedCount: 0,
		stopKeepAliveCount: 0,
		runTask: () => {
			if (!holder.fn) throw new assert.Assertion({ message: 'No task to run' });
			if (!holder.arg)
				throw new assert.Assertion({ message: 'No arg for task to run' });

			const fn = holder.fn;
			const arg = holder.arg;

			holder.timerId = 0;
			holder.nextTime = 0;
			holder.fn = undefined;
			holder.arg = undefined;

			fn(arg);
		},
		link: {
			betweenMs: 50,
			backoffMs: 10000,
			schedule: (fetchPoll, delayMs, core) => {
				holder.delayMs = delayMs;
				const id = holder.nextTimerId--;

				if (holder.timerId)
					throw new assert.Assertion({ message: 'timerId already taken' });

				holder.timerId = id;
				holder.nextTime = holder.time + delayMs;
				holder.fn = fetchPoll;
				holder.arg = core;
				return id;
			},
			prepareMessageFetch: (href) => {
				const fn = async () => {
					holder.fetchHref = href;

					const [p, settle] = withSettle(
						typeof holder.fetchDo === 'boolean'
							? holder.fetchDo
							: new Error('Boom')
					);
					holder.fetchSettle = settle;
					return p;
				};
				fn.abort = () => void (holder.abortCount += 1);

				return fn;
			},
			pollFailed: () => void (holder.failedCount += 1),
			clearTimer: (id: TimerId) => {
				if (id !== holder.timerId)
					throw new assert.Assertion({
						message: "Cleared timerId doesn't match",
					});

				holder.timerId = 0;
				holder.nextTime = 0;
				holder.fn = undefined;
				holder.arg = undefined;
			},
			stopKeepAlive: () => void (holder.stopKeepAliveCount += 1),
		},
	};
	return holder;
}

const suiteRuns: (() => void)[] = [];

const longPoller = suite('LongPoller');

// --- TESTS ---

longPoller('Basic flow', async () => {
	// Given
	const holder = makeLinkHolder(1000);
	const uut = new Longpoller(holder.link);

	// Then
	// Initially (without connect) the Longpoller is inactive
	assert.is(uut.active, false, 'Longpoller is unexpectedly active');
	assert.type(holder.fn, 'undefined', 'fetch unexpectedly scheduled');

	// When
	uut.connect('/poll-endpoint');

	// Then:
	// Connecting should schedule a task to initiate the fetch
	assert.is(uut.active, true, 'Longpoller is unexpectedly inactive');
	assert.not.type(holder.fn, 'undefined', 'fetch unexpectedly NOT scheduled');
	assert.is(
		holder.delayMs,
		holder.link.betweenMs,
		'schedule delay not betweenMs'
	);

	// Get ready to observe: fetch (1)
	holder.fetchDo = true;
	holder.fetchHref = undefined;
	holder.abortCount = 0;

	// Advance timeline to: initiate fetch (1)
	holder.time += holder.link.betweenMs + 5;
	holder.runTask();

	// Get ready to observe: reschedule
	// Advance timeline to: settle fetch (1)
	holder.delayMs = -1;
	holder.time += 95;
	if (!holder.fetchSettle)
		throw new assert.Assertion({ message: 'Cannot settle fetch (1)' });
	await holder.fetchSettle();
	assert.is(holder.fetchHref, '/poll-endpoint', 'fetch did not execute (1)');
	assert.not.type(
		holder.fn,
		'undefined',
		'next fetch unexpectedly NOT scheduled (1)'
	);
	assert.is(
		holder.delayMs,
		holder.link.betweenMs,
		'schedule delay not betweenMs (1)'
	);

	// Get ready to observer: fetch (2)
	holder.fetchDo = true;
	holder.fetchHref = undefined;
	holder.abortCount = 0;

	// Advance timeline to: initiate fetch (2)
	holder.time += holder.link.betweenMs + 5;
	holder.runTask();

	// Get ready to observe: reschedule
	// Advance timeline to: settle fetch (2)
	holder.delayMs = -1;
	holder.time += 95;
	if (!holder.fetchSettle)
		throw new assert.Assertion({ message: 'Cannot settle fetch (2)' });
	await holder.fetchSettle();
	assert.is(holder.fetchHref, '/poll-endpoint', 'fetch did not execute (2)');
	assert.not.type(
		holder.fn,
		'undefined',
		'next fetch unexpectedly NOT scheduled (2)'
	);
	assert.is(
		holder.delayMs,
		holder.link.betweenMs,
		'schedule delay not betweenMs (2)'
	);

	// Get ready to observer: fetch (3) being ABORTED
	holder.fetchDo = false; // simulate abort during fetch
	holder.fetchHref = undefined;
	holder.abortCount = 0;
	holder.stopKeepAliveCount = 0;

	// Advance timeline to: initiate fetch (3)
	holder.time += holder.link.betweenMs + 5;
	holder.runTask();

	// Advance timeline to: settle ABORTED fetch (3)
	holder.time += 95;
	holder.delayMs = -1;
	if (!holder.fetchSettle)
		throw new assert.Assertion({ message: 'Cannot settle fetch (3)' });

	// disconnect() "abort()"s THEN settle fetch
	uut.disconnect();
	await holder.fetchSettle();

	// disconnect() should have: abort() & stopKeepAlive();
	assert.is(holder.abortCount, 1, 'disconnect failed to abort (3)');
	assert.is(
		holder.stopKeepAliveCount,
		1,
		'disconnect failed to stop keepAlive (3)'
	);

	// ... but this does not cause pollFailed() to be falled
	assert.is(holder.failedCount, 0, 'unexpected failed count (3)');

	// ... but it should have suppressed rescheduling as that
	// as that is the responsibility of the disconnect/abort party.
	assert.is(uut.active, false, 'Longpoller is unexpectedly active (3)');
	assert.type(holder.fn, 'undefined', 'fetch unexpectedly scheduled (3)');
});

longPoller('Basic keepAlive flow', async () => {
	// Given
	const holder = makeLinkHolder(1000);
	const uut = new Longpoller(holder.link);

	// Then
	// Initially (without connect) the Longpoller is inactive
	assert.is(uut.active, false, 'Longpoller is unexpectedly active');
	assert.type(holder.fn, 'undefined', 'fetch unexpectedly scheduled');

	// When
	uut.connect('/poll-endpoint');

	// Then:
	// Connecting should schedule a task to initiate the fetch
	assert.is(uut.active, true, 'Longpoller is unexpectedly inactive');
	assert.not.type(holder.fn, 'undefined', 'fetch unexpectedly NOT scheduled');
	assert.is(
		holder.delayMs,
		holder.link.betweenMs,
		'schedule delay not betweenMs'
	);

	// Get ready to observe: fetch (1)
	holder.fetchDo = true;
	holder.fetchHref = undefined;
	holder.abortCount = 0;

	// Advance timeline to: initiate fetch (1)
	holder.time += holder.link.betweenMs + 5;
	holder.runTask();

	// Get ready to observe: reschedule
	// Advance timeline to: settle fetch (1)
	holder.delayMs = -1;
	holder.time += 95;
	if (!holder.fetchSettle)
		throw new assert.Assertion({ message: 'Cannot settle fetch (1)' });
	await holder.fetchSettle();
	assert.is(holder.fetchHref, '/poll-endpoint', 'fetch did not execute (1)');
	assert.not.type(
		holder.fn,
		'undefined',
		'next fetch unexpectedly NOT scheduled (1)'
	);
	assert.is(
		holder.delayMs,
		holder.link.betweenMs,
		'schedule delay not betweenMs (1)'
	);

	// ---
	// Get ready to observe: fetch (2) being ABORTED as part of a keepAlive
	holder.fetchDo = false; // simulate abort during fetch
	holder.fetchHref = undefined;
	holder.abortCount = 0;
	holder.stopKeepAliveCount = 0;

	// Advance timeline to: initiate fetch (2)
	holder.time += holder.link.betweenMs + 5;
	holder.runTask();

	// Advance timeline to: settle ABORTED fetch (2)
	holder.time += 95;
	holder.delayMs = -1;
	if (!holder.fetchSettle)
		throw new assert.Assertion({ message: 'Cannot settle fetch (2)' });

	// disconnect() "abort()"s THEN connect() THEN settle fetch
	uut.disconnect();
	uut.connect('/poll-endpoint');
	await holder.fetchSettle();

	// disconnect() should have: abort() & stopKeepAlive();
	assert.is(holder.abortCount, 1, 'disconnect failed to abort (2)');
	assert.is(
		holder.stopKeepAliveCount,
		1,
		'disconnect failed to stop keepAlive (2)'
	);

	// ... but this does not cause pollFailed() to be falled
	assert.is(holder.failedCount, 0, 'unexpected failed count (2)');

	// ... but the connect() should successfully reschedule
	// while the abort changes time to fetch initiation
	assert.is(uut.active, true, 'Longpoller is unexpectedly inactive (2)');
	assert.not.type(
		holder.fn,
		'undefined',
		'fetch unexpectedly NOT scheduled (2)'
	);
	assert.is(
		holder.delayMs,
		holder.link.backoffMs,
		'schedule delay not backoffMs (2)'
	);

	// ---
	// Get ready to observe: recovered fetch (3)
	holder.fetchDo = true;
	holder.fetchHref = undefined;
	holder.abortCount = 0;
	holder.stopKeepAliveCount = 0;

	// Advance timeline to: initiate fetch (3)
	holder.time += holder.delayMs + 5;
	holder.runTask();

	// Get ready to observe: reschedule
	// Advance timeline to: settle fetch (3)
	holder.delayMs = -1;
	holder.time += 95;
	if (!holder.fetchSettle)
		throw new assert.Assertion({ message: 'Cannot settle fetch (3)' });
	await holder.fetchSettle();
	assert.is(holder.fetchHref, '/poll-endpoint', 'fetch did not execute (3)');
	assert.not.type(
		holder.fn,
		'undefined',
		'next fetch unexpectedly NOT scheduled (3)'
	);
	assert.is(
		holder.delayMs,
		holder.link.betweenMs,
		'schedule delay not betweenMs (3)'
	);
});

longPoller('Poll failure', async () => {
	// Given
	const holder = makeLinkHolder(1000);
	const uut = new Longpoller(holder.link);

	// Then
	// Initially (without connect) the Longpoller is inactive
	assert.is(uut.active, false, 'Longpoller is unexpectedly active');
	assert.type(holder.fn, 'undefined', 'fetch unexpectedly scheduled');

	// When
	uut.connect('/poll-endpoint');

	// Then:
	// Connecting should schedule a task to initiate the fetch
	assert.is(uut.active, true, 'Longpoller is unexpectedly inactive');
	assert.not.type(holder.fn, 'undefined', 'fetch unexpectedly NOT scheduled');
	assert.is(
		holder.delayMs,
		holder.link.betweenMs,
		'schedule delay not betweenMs'
	);

	// Get ready to observe: fetch (1)
	holder.fetchDo = true;
	holder.fetchHref = undefined;
	holder.abortCount = 0;

	// Advance timeline to: initiate fetch (1)
	holder.time += holder.link.betweenMs + 5;
	holder.runTask();

	// Get ready to observe: reschedule
	// Advance timeline to: settle fetch (1)
	holder.delayMs = -1;
	holder.time += 95;
	if (!holder.fetchSettle)
		throw new assert.Assertion({ message: 'Cannot settle fetch (1)' });
	await holder.fetchSettle();
	assert.is(holder.fetchHref, '/poll-endpoint', 'fetch did not execute (1)');
	assert.not.type(
		holder.fn,
		'undefined',
		'next fetch unexpectedly NOT scheduled (1)'
	);
	assert.is(
		holder.delayMs,
		holder.link.betweenMs,
		'schedule delay not betweenMs (1)'
	);

	// ---
	// Get ready to observe: fetch (2) FAILING
	holder.fetchDo = undefined; // simulate fetch throwing Error
	holder.fetchHref = undefined;
	holder.abortCount = 0;
	holder.stopKeepAliveCount = 0;
	holder.failedCount = 0;

	// Advance timeline to: initiate fetch (2)
	holder.time += holder.delayMs + 5;
	holder.runTask();

	// Get ready to observe: fetch (2) throwing Error
	// Advance timeline to: settle fetch (2)
	holder.delayMs = -1;
	holder.time += 95;
	if (!holder.fetchSettle)
		throw new assert.Assertion({ message: 'Cannot settle fetch (2)' });
	await holder.fetchSettle();

	// ... did it call disconnect()
	assert.is(holder.stopKeepAliveCount, 1, 'failed to call disconnect (2)');

	// ... did it call pollFailed()
	assert.is(holder.failedCount, 1, 'failed to call pollFailed (2)');

	// ... next poll should NOT be scheduled
	assert.type(holder.fn, 'undefined', 'next fetch unexpectedly scheduled (2)');
	assert.is(holder.delayMs, -1, 'b: next fetch unexpectedly scheduled (2)');
});

// --- TESTS END ---

suiteRuns.push(longPoller.run);

function all() {
	return suiteRuns.slice();
}

export { all };
