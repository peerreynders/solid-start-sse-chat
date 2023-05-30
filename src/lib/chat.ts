// file: src/lib/chat.ts
import { isTimeValue } from './shame';

export type ChatMessage = {
	timestamp: number;
	from: string;
	body: string;
};

export type Chat = {
	kind: 'chat';
	messages: ChatMessage[];
};

export type Welcome = Omit<Chat, 'kind'> & {
	kind: 'welcome';
	id: string;
};

export type KeepAlive = {
	kind: 'keep-alive';
	timestamp: number;
};

export type Message = Chat | Welcome | KeepAlive;

function makeChat(messages: ChatMessage[]) {
	const message: Chat = {
		kind: 'chat',
		messages,
	};

	return message;
}

function makeWelcome(clientId: string, messages: ChatMessage[]) {
	const message: Welcome = {
		kind: 'welcome',
		id: clientId,
		messages,
	};

	return message;
}

function makeKeepAlive(timestamp: number) {
	const message: KeepAlive = {
		kind: 'keep-alive',
		timestamp,
	};

	return message;
}

function fromMessageTimestamp(message: Message) {
	switch (message.kind) {
		case 'chat':
		case 'welcome':
			return message.messages.length > 0
				? message.messages[0].timestamp
				: undefined;
		case 'keep-alive':
			return message.timestamp;
	}
}

function isChatMessage(data: unknown): data is ChatMessage {
	if (typeof data !== 'object' || data === null) return false;

	const message = data as Record<string, unknown>;
	if (!isTimeValue(message.timestamp)) return false;

	if (typeof message.from !== 'string') return false;

	if (typeof message.body !== 'string') return false;

	return true;
}

function isChat(message: Record<string, unknown>): message is Chat {
	if (message.kind !== 'chat') return false;

	return Array.isArray(message.messages)
		? message.messages.every(isChatMessage)
		: false;
}

function isWelcome(message: Record<string, unknown>): message is Welcome {
	if (message.kind !== 'welcome') return false;

	if (typeof message.id !== 'string') return false;

	return Array.isArray(message.messages)
		? message.messages.every(isChatMessage)
		: false;
}

function isKeepAlive(message: Record<string, unknown>): message is KeepAlive {
	if (message.kind !== 'keep-alive') return false;

	return typeof message.timestamp === 'number';
}

function isMessage(message: unknown): message is Message {
	if (typeof message !== 'object' || message === null) return false;

	return (
		isChat(message as Record<string, unknown>) ||
		isWelcome(message as Record<string, unknown>) ||
		isKeepAlive(message as Record<string, unknown>)
	);
}

function fromJson(raw: string) {
	const message = JSON.parse(raw);
	return isMessage(message) ? message : undefined;
}

export { fromMessageTimestamp, fromJson, makeChat, makeKeepAlive, makeWelcome };
