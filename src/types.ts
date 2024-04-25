// file: src/types.ts
import type { ChatMessage, Welcome } from './lib/chat';

export type History = Array<ChatMessage>;

export type HistoryReturn = [
	{
		messages: () => Promise<History>;
		clientId: () => Promise<string | undefined>;
	},
	{
		reset: (message: Welcome) => void;
		shunt: (recent: ChatMessage[] | ChatMessage) => void;
	},
];
