// file: src/server/pub-sub/message-cache.ts

import type { ChatMessage } from '~/lib/chat';

function lastFirstWhile(
	latest: readonly ChatMessage[],
	buffer: readonly ChatMessage[][],
	fn: (message: ChatMessage, i: number) => boolean
) {
	for (
		let source = latest,
			bufferIndex = buffer.length,
			sourceIndex = source.length - 1,
			index = 0;
		bufferIndex > 0 || sourceIndex >= 0;
		index += 1, sourceIndex -= 1
	) {
		if (sourceIndex < 0) {
			bufferIndex -= 1;
			source = buffer[bufferIndex];
			sourceIndex = source.length - 1;
		}
		if (!fn(source[sourceIndex], index)) break;
	}
}

class MessageCache {
	// messages oldest to newest
	latest: ChatMessage[] = [];
	// buffers olders to newest
	buffer: ChatMessage[][] = [];
	// every `maxMessages` push `latest` onto `buffer`
	readonly maxMessages: number;

	constructor(maxMessages = 16) {
		this.maxMessages = maxMessages;
	}

	sizeAfter(after: number) {
		let size = 0;
		lastFirstWhile(this.latest, this.buffer, (message) => {
			if (message.timestamp <= after) return false;
			size += 1;
			return true;
		});
		return size;
	}

	sliceAfter(after = 0) {
		const slice: ChatMessage[] = [];
		lastFirstWhile(this.latest, this.buffer, (message, i) => {
			if (message.timestamp <= after) return false;
			slice[i] = message;
			return true;
		});
		return slice;
	}

	cache(message: ChatMessage) {
		const latest = this.latest;
		latest.push(message);
		if (latest.length >= this.maxMessages) {
			this.buffer.push(latest);
			this.latest = [];
		}
	}
}

export { MessageCache };
