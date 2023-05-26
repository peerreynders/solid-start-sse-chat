// file: src/components/message-context

import { createContext, useContext, type ParentProps } from 'solid-js';
import { createStore } from 'solid-js/store';
import { isServer } from 'solid-js/web';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('1234567890abcdef', 12);

type ChatMessage = {
	timestamp: number;
	from: string;
	body: string;
};

const historyPool: [ChatMessage[], ChatMessage[]] = [[], []];
let currentHistory = 0;

function makeHolder() {
	const id = nanoid();
	const [history, set] = createStore<ChatMessage[]>(
		historyPool[currentHistory]
	);

	return {
		context: {
			id,
			history,
		},
		set,
	};
}

const contextHolder = makeHolder();
const MessageContext = createContext(contextHolder.context);

function MessageProvider(props: ParentProps) {
	return (
		<MessageContext.Provider value={contextHolder.context}>
			{props.children}
		</MessageContext.Provider>
	);
}

function useMessages() {
	return useContext(MessageContext);
}

let cycles = 10;

function pushMessage() {
	cycles -= 1;

	const timestamp = Date.now();
	const from = nanoid();
	const body = `Message ${cycles}:${timestamp}`;
	console.log(timestamp);

	const next = 1 - currentHistory;
	const source = historyPool[currentHistory];
	const target = historyPool[next];
	target[0] = { timestamp, from, body };

	const offset = target.length;
	for (let i = 0; i < source.length; i += 1) target[i + offset] = source[i];

	contextHolder.set(target);

	source.length = 0;
	currentHistory = next;

	if (cycles > 0) setTimeout(pushMessage, 1000);
}

if (!isServer) setTimeout(pushMessage, 3000);

export { MessageProvider, useMessages };
