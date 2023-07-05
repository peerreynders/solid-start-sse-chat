import { suite } from 'uvub';
import * as assert from 'uvub/assert';
import { createEffect, createRoot } from 'solid-js';

import { makeCount } from '../../../src/components/message-context/reference-count';

const suiteRuns: (() => void)[] = [];

const referenceCount = suite('Reference Count');

// --- TESTS ---

referenceCount('General behaviour', () => {
	// Given
	const [count, handle] = makeCount();
	assert.is(count(), 0, 'count is not initialized to 0');

	// When
	handle.increment();

	// Then
	assert.is(count(), 1, 'count did not increment to 1');

	handle.increment();
	assert.is(count(), 2, 'count did not increment to 2');

	handle.increment();
	assert.is(count(), 3, 'count did not increment to 3');

	handle.decrement();
	assert.is(count(), 2, 'count did not decrement to 2');

	handle.increment();
	assert.is(count(), 3, 'count did not increment to 3 (b)');

	handle.decrement();
	assert.is(count(), 2, 'count did not decrement to 2 (b)');

	handle.decrement();
	assert.is(count(), 1, 'count did not decrement to 1');

	handle.decrement();
	assert.is(count(), 0, 'count did not decrement to 0');

	handle.decrement();
	assert.is(count(), 0, 'count did not stay at 0');

	handle.increment();
	assert.is(count(), 1, 'count did not increment to 1 (b)');
});

referenceCount('Reactive behaviour', async () => {
	const result = await new Promise((resolve, _reject) => {
		createRoot((dispose) => {
			// Given (setup)
			const actual: number[] = [];
			const [count, handle] = makeCount();

			createEffect(() => {
				actual.push(count()); // 0 during setup
			});

			setTimeout(() => {
				// When (Actions)
				handle.increment(); // 1
				handle.increment(); // 2
				handle.increment(); // 3
				handle.decrement(); // 2
				handle.increment(); // 3
				handle.decrement(); // 2
				handle.decrement(); // 1
				handle.decrement(); // 0
				handle.decrement(); // this one is ignored
				handle.increment(); // 1

				dispose();
				resolve(actual);
			});
		});
	});

	// Then (Result)
	const expected = [0, 1, 2, 3, 2, 3, 2, 1, 0, 1];
	assert.equal(result, expected, `Expected: ${expected} actual: ${result}`);
});

// --- TESTS END ---

suiteRuns.push(referenceCount.run);

function all() {
	return suiteRuns.slice();
}

export { all };
