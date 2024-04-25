// file: src/server/pub/message-cache.ts
import type { ChatMessage } from '~/lib/chat';

// This MessageCache simply stores all the
// ChatMessages passed to it with `cache`.
// It stores them in blocks of `maxMessages`
// Internally `buffer` holds filled blocks
// while `latest` is being filled with the
// most recent arrivals.
// Once `latest` is filled to capacity it's
// pushed onto `buffer`.
//
// So inherently each block including `latest`
// contain their oldest entry at index `0`
// their most recent entry at `length - 1`,
// while `buffer` has the oldest block at
// index 0 and it's most recent block at
// `buffer.length - 1` with `last` being
// the most recent block of items.
//
// `sliceAfter(timestamp)` needs to return
// a single contiguous array with all the items
// that are more recent than (excluding) `timestamp`
// with the most recent at index 0 and the oldest
// at `length - 1`

// `lastFirstWhile` is a helper function that
// navigates through `last` and `buffer` in
// the most recent to oldest item order.
// On each item the callback
// `fn(message: ChatMessage, i:number) => boolean`
// is called to pass the current message
// in the sequence. It terminates before the
// end when `fn` returns `false`

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
