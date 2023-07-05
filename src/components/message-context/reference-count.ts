// file: src/components/message-context/reference-count.ts

import { createSignal, type Accessor } from 'solid-js';

const increment = (n: number) => n + 1;
const decrement = (n: number) => (n > 0 ? n - 1 : 0);

function makeCount() {
	const [count, setCount] = createSignal(0);
	const pair: [
		Accessor<number>,
		{
			increment: () => void;
			decrement: () => void;
		}
	] = [
		count,
		{
			increment: () => setCount(increment),
			decrement: () => setCount(decrement),
		},
	];

	return pair;
}

export { makeCount };
