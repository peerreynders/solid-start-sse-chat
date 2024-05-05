// file: src/lib/chat.ts
import { isTimeValue } from './shame';

// - timestamp: milliseconds since epoch which also doubles as the `eventId`
// - from: clientId that sent the message
// - body: message body

export type ChatMessage = {
	timestamp: number;
	from: string;
	body: string;
};

// type `Message` needs to be serializible with
// `JSON.stringfy()` while being part of
// a discrimnated union so they can be easily
// classifed with TypeScript
// https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions

// - `timestamp` is the most recent timestamp within messages
// only custom Chat messages (the first one to a
// recently connected subscriber) have a (client) `id`
export type Chat = {
	kind: 'chat';
	id?: string;
	timestamp: number;
	messages: ChatMessage[];
};

// - `id` is the `clientId` assigned by the server
export type Welcome = Omit<Chat, 'kind' | 'id'> & {
	kind: 'welcome';
	id: string;
};

// - timestamp: milliseconds since epoch
// 	when the server sent this event
export type KeepAlive = {
	kind: 'keep-alive';
	timestamp: number;
};

export type Message = Chat | Welcome | KeepAlive;

const isObjectLike = (data: unknown): data is Record<string, unknown> =>
	typeof data === 'object' && data !== null;

const isChatMessage = (message: unknown): message is ChatMessage =>
	isObjectLike(message) &&
	isTimeValue(message.timestamp) &&
	typeof message.from === 'string' &&
	typeof message.body === 'string';

const isChat = (message: Record<string, unknown>): message is Chat =>
	message.kind === 'chat' &&
	isTimeValue(message.timestamp) &&
	(Array.isArray(message.messages)
		? message.messages.every(isChatMessage)
		: false);

const isWelcome = (message: Record<string, unknown>): message is Welcome =>
	message.kind === 'welcome' &&
	isTimeValue(message.timestamp) &&
	typeof message.id === 'string' &&
	(Array.isArray(message.messages)
		? message.messages.every(isChatMessage)
		: false);

const isKeepAlive = (message: Record<string, unknown>): message is KeepAlive =>
	message.kind === 'keep-alive' && isTimeValue(message.timestamp);

const isMessage = (message: unknown): message is Message =>
	isObjectLike(message) &&
	(isChat(message) || isWelcome(message) || isKeepAlive(message));

function fromJson(raw: string) {
	const message = JSON.parse(raw);
	return isMessage(message) ? message : undefined;
}

export { fromJson };
