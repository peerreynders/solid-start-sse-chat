// file: src/server/sub/streamer.ts
import type { SourceController } from '../event-stream';

// The `Streamer`'s client
type Receiver = {
	send: SourceController['send'];
	id: string; // subscription ID
};

// The `Streamer`'s internal data
type Core = {
	receivers: Map<string, Receiver>;
	onChange: undefined | ((kind: ChangeKind) => void);
};

// idle: transitioned to no receivers
// 		(no need for keep alive messages)
// running: transitioned from no to some receivers
// 		(need keep alive messages)
// messageSent: sent message to at least one registered receiver
// 		(reset keep alive timer)
const STREAMER_CHANGE = {
	idle: 0,
	running: 1,
	messageSent: 2,
} as const;

// 0 | 1 | 2
type ChangeKind = (typeof STREAMER_CHANGE)[keyof typeof STREAMER_CHANGE];

// Symbol used as an obfuscated property on
// Streamer class in lieu of using # for real
// private property (casual, rather than enforced privacy)
const _core = Symbol('core');

export type Link = Pick<Core, 'onChange'>;

// Constructor argument
// The "Link" between the data producer and
//	the Streamer instance managing the receiver
//	bound event streams
// - schedule:
// - clearTimer:
// - sendInitialMessage;
// - onChange:
//
class Streamer {
	[_core]: Core;

	constructor(link: Link) {
		this[_core] = {
			receivers: new Map<string, Receiver>(),
			onChange: link.onChange,
		};
	}

	// The `STREAMER_CHANGE.running`
	// `onChange` notification
	// is invoked if there were
	// no `receivers` before the new
	// `receiver` was added.
	add(send: Receiver['send'], id: string) {
		const core = this[_core];
		console.log('Streamer add', id);

		const receiver: Receiver = {
			send,
			id,
		};

		const lastSize = core.receivers.size;
		core.receivers.set(id, receiver);
		if (lastSize < 1 && core.onChange) core.onChange(STREAMER_CHANGE.running);
	}

	// sends the data with the provided event ID
	// to all the currently registered `receivers`
	// The `STREAMER_CHANGE.messageSent`
	// `onChange` notification
	// is only invoked if at least one receiver
	// was set the message.
	//
	// This is intentionally implemented as function property
	// rather than a method
	send = (data: string, eventId?: string) => {
		const core = this[_core];
		console.log('streamer send', data, eventId, core.receivers.size);
		if (core.receivers.size < 1) return;

		for (const rec of core.receivers.values()) {
			rec.send(data, eventId);
		}
		if (core.onChange) core.onChange(STREAMER_CHANGE.messageSent);
	};

	// `unsubscribe` drops the specified
	// `id`'s `receiver` from the `Set<Receiver>`.
	//
	// The `STREAMER_CHANGE.idle`
	// `onChange` notification
	// is invoked if there are
	// no `receivers` left after the provided
	// `receiver` was removed.
	//
	// NOTE: this doesn't close the stream, that is done on a higher
	// level.
	unsubscribe(id: string) {
		const core = this[_core];
		console.log('Streamer unsubscribe', id, core.receivers.size);
		const lastSize = core.receivers.size;
		const result = core.receivers.delete(id);
		if (!result) return false;

		if (lastSize === 1 && core.onChange) core.onChange(STREAMER_CHANGE.idle);
		return true;
	}
}

export { Streamer, STREAMER_CHANGE };
