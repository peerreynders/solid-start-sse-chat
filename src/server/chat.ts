// file: src/server/chat.ts
import type {
	Chat,
	ChatMessage,
	KeepAlive,
	Message,
	Welcome,
} from '../lib/chat';

const makeChat = (
	messages: ChatMessage[],
	timestamp: number,
	clientId?: string
): Chat =>
	clientId
		? {
				kind: 'chat',
				timestamp,
				messages,
				id: clientId,
			}
		: {
				kind: 'chat',
				timestamp,
				messages,
			};

const makeWelcome = (
	messages: ChatMessage[],
	timestamp: number,
	clientId: string
): Welcome => ({
	kind: 'welcome',
	timestamp,
	messages,
	id: clientId,
});

const makeClientRequest = (id: string, lastTime?: number) =>
	lastTime ? { id, lastTime } : { id };

const makeClientReply = (
	messages: ChatMessage[],
	timestamp: number,
	clientId: string,
	lastTime?: number
) => (lastTime ? makeChat : makeWelcome)(messages, timestamp, clientId);

const makeKeepAlive = (timestamp: number): KeepAlive => ({
	kind: 'keep-alive',
	timestamp,
});

export type { Chat, ChatMessage, Message, Welcome };

export {
	makeChat,
	makeClientReply,
	makeClientRequest,
	makeKeepAlive,
	makeWelcome,
};
