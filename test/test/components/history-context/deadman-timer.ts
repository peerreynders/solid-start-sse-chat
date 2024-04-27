import { suite } from 'uvub';
import * as assert from 'uvub/assert';

import {
	DeadmanTimer,
	type Link,
} from '../../../../src/components/history-context/deadman-timer';

type TimerId = ReturnType<typeof setTimeout>;

function makeLinkHolder(time = 0) {
	const holder: {
		time: number;
		nextTimerId: number;
		timerId: TimerId;
		nextTime: number;
		count: 0;
		onKeepAlive: (() => void) | undefined;
		runKeepAlive: () => void;
		link: Link;
	} = {
		time,
		nextTimerId: 9999999,
		timerId: 0,
		nextTime: 0,
		count: 0,
		onKeepAlive: undefined,
		runKeepAlive() {
			if (!holder.onKeepAlive)
				throw new assert.Assertion({ message: 'No keepAlive function to run' });

			const fn = holder.onKeepAlive;

			holder.timerId = 0;
			holder.onKeepAlive = undefined;

			fn();
		},
		link: {
			actionMs: 20000,
			action: () => ++holder.count,
			timeMs: () => holder.time,
			schedule: (action, delay, core) => {
				const id = holder.nextTimerId--;

				if (holder.timerId)
					throw new assert.Assertion({ message: 'timerId already taken' });

				holder.timerId = id;
				holder.nextTime = holder.time + delay;
				holder.onKeepAlive = () => action(core);

				return id;
			},
			clearTimer: (id: number) => {
				if (id !== holder.timerId)
					throw new assert.Assertion({
						message: "Cleared timerId doesn't match",
					});

				holder.timerId = 0;
				holder.onKeepAlive = undefined;
			},
		},
	};

	return holder;
}

const suiteRuns: (() => void)[] = [];

const deadmanTimer = suite('DeadmanTimer');

// --- TESTS ---

deadmanTimer('Start timer, extend, then fire', () => {
	// Given
	const holder = makeLinkHolder(1000);
	const uut = new DeadmanTimer(holder.link);

	// When
	uut.start();
	assert.ok(holder.timerId > 0, `KeepAlive wasn't scheduled`);
	const firstTime = holder.time + holder.link.actionMs;

	holder.time += 5000;
	const firstTimeDelayed = holder.time + holder.link.actionMs;
	// extend time to fire
	uut.start();
	holder.time = firstTime + 5;
	holder.runKeepAlive();

	// Then
	holder.time = firstTimeDelayed + 5;
	holder.runKeepAlive();
	assert.is(holder.count, 1, 'keepAlive failed to fire');
});

deadmanTimer('Start timer, extend, then stop', () => {
	// Given
	const holder = makeLinkHolder(1000);
	const uut = new DeadmanTimer(holder.link);

	// When
	uut.start();
	assert.ok(holder.timerId > 0, `KeepAlive wasn't scheduled`);
	const firstTime = holder.time + holder.link.actionMs;

	holder.time += 5000;
	const firstTimeDelayed = holder.time + holder.link.actionMs;
	// extend time to fire
	uut.start();
	holder.time = firstTime + 5;
	holder.runKeepAlive();

	// Then
	holder.time = firstTimeDelayed;
	uut.stop();
	assert.ok(holder.timerId < 1, `KeepAlive wasn't cacelled`);
});

// --- TESTS END ---

suiteRuns.push(deadmanTimer.run);

function all() {
	return suiteRuns.slice();
}

export { all };
