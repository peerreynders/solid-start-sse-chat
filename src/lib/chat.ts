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

export type Message = Chat | Welcome;

function makeChat(messages: ChatMessage[]) {
	const message: Chat = {
		kind: 'chat',
		messages,
	};

	return message;
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

function makeWelcome(clientId: string, messages: ChatMessage[]) {
	const message: Welcome = {
		kind: 'welcome',
		id: clientId,
		messages,
	};

	return message;
}

function isMessage(message: unknown): message is Message {
	if (typeof message !== 'object' || message === null) return false;

	return (
		isChat(message as Record<string, unknown>) ||
		isWelcome(message as Record<string, unknown>)
	);
}

function fromJson(raw: string) {
	const message = JSON.parse(raw);
	return isMessage(message) ? message : undefined;
}

export { makeChat, makeWelcome, fromJson };
