// file: src/components/message-context/reference-count.ts

import { createSignal, type Accessor } from 'solid-js';

type Count = [
	count: Accessor<number>,
	mutate: {
		increment: () => void;
		decrement: () => void;
	},
];

const increment = (n: number) => n + 1;
const decrement = (n: number) => (n > 0 ? n - 1 : 0);

function makeCount(): Count {
	const [count, setCount] = createSignal(0);
	return [
		count,
		{
			increment: () => setCount(increment),
			decrement: () => setCount(decrement),
		},
	];
}

export { makeCount };
