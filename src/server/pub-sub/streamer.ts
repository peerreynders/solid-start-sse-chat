// file: src/server/pub-sub/streamer.ts

type TimerId = ReturnType<typeof setTimeout>;

// The `Streamer`'s client
type Receiver = {
	send: (data: string, id?: string) => void;
	openId: TimerId | undefined;
	clientId: string;
};

type InitialPayload = () => [data: string, id?: string];

// The `Streamer`'s internal data
type Core = {
	receivers: Set<Receiver>;
	schedule: (addReceiverThunk: () => void) => TimerId;
	clearTimer: (id: TimerId) => void;
	onChange: undefined | ((kind: ChangeKind) => void);
};

const STREAMER_CHANGE = {
	idle: 0,
	running: 1,
	messageSent: 2,
} as const;

// 0 | 1 | 2
type ChangeKind = (typeof STREAMER_CHANGE)[keyof typeof STREAMER_CHANGE];

// `removeReceiver` drops the provided
// `receiver` from the `Set<Receiver>`.
//
// The `STREAMER_CHANGE.idle`
// `onChange` notification
// is only invoked if there are
// no `receivers` left after the provided
// `receiver` was removed.
function removeReceiver(core: Core, receiver: Receiver) {
	console.log('removeReceiver', receiver.clientId, core.receivers.size);
	const lastSize = core.receivers.size;
	const result = core.receivers.delete(receiver);
	if (!result) return false;

	if (lastSize === 1 && core.onChange) core.onChange(STREAMER_CHANGE.idle);
	return true;
}

// If an `initialPayload` function is provided
// `addReceiver` will call it to get the
// the initial data to send to only this
// `receiver` before it adds it to the `Set<Receiver>`
//
// The `STREAMER_CHANGE.running`
// `onChange` notification
// is only invoked if there were
// no `receivers` before the provided
// `receiver` was added.
function addReceiver(
	core: Core,
	receiver: Receiver,
	initialPayload?: InitialPayload
) {
	console.log('addReceiver', receiver.clientId, !!receiver.openId);
	// Check if unsubscribed/closed already
	if (!receiver.openId) return;

	receiver.openId = undefined;
	if (initialPayload) {
		const [data, id] = initialPayload();
		receiver.send(data, id);
	}
	const lastSize = core.receivers.size;
	core.receivers.add(receiver);
	console.log('addReceiver size', core.receivers.size);

	if (lastSize < 1 && core.onChange) core.onChange(STREAMER_CHANGE.running);
}

// Symbol used as an obfuscated property on
// Streamer class in lieu of using # for real
// private property (casual, rather than enforced privacy)
const _core = Symbol('core');

export type Link = Pick<Core, 'schedule' | 'clearTimer' | 'onChange'>;

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
			receivers: new Set<Receiver>(),
			schedule: link.schedule,
			clearTimer: link.clearTimer,
			onChange: link.onChange,
		};
	}

	// `add` is the external interface to add a new `Receiver`
	// Note that the `Receiver` is scheduled to be added later
	// in order to avoid any problems that can arise when the
	// the `Response` and the initial event is sent synchronously.
	//
	// `unregister` checks `openId` first. If `openId`
	// is still set then the `Receiver` isn't in the
	// `receiver` `Set` yet.
	//
	add(
		send: Receiver['send'],
		clientId: string,
		initialPayload?: InitialPayload
	) {
		const core = this[_core];

		const receiver: Receiver = {
			send,
			openId: undefined,
			clientId,
		};

		const unregister = () => {
			console.log('unregister', receiver.clientId);
			if (receiver.openId) {
				// receiver hasn't been added yet
				core.clearTimer(receiver.openId);
				receiver.openId = undefined;

				// Pretend receiver was removed
				return true;
			}

			// false : wasn't in receivers
			// true : present and removed
			return removeReceiver(core, receiver);
		};

		receiver.openId = core.schedule(() =>
			addReceiver(core, receiver, initialPayload)
		);
		console.log('add', receiver.clientId);
		return unregister;
	}

	// sends the data with the provided event ID
	// to all the currently registered `receivers`
	// The `STREAMER_CHANGE.messageSent`
	// `onChange` notification
	// is only invoked if at least one receiver
	// was set the message.
	send(data: string, id?: string) {
		const core = this[_core];
		console.log('streamer send', data, id, core.receivers.size);
		if (core.receivers.size < 1) return;

		for (const rec of core.receivers) {
			rec.send(data, id);
		}
		if (core.onChange) core.onChange(STREAMER_CHANGE.messageSent);
	}
}

export { Streamer, STREAMER_CHANGE };
