type TimerId = ReturnType<typeof setTimeout>;

type Receiver = {
	send: (data: string, id?: string) => void;
	openId: TimerId | undefined;
	clientId: string;
	lastTime: number;
};

type Core = {
	receivers: Set<Receiver>;
	newClientIdHeaders: () => [clientId: string, headers: Record<string, string>];
	schedule: (
		fn: (core: Core, receiver: Receiver) => void,
		core: Core,
		receiver: Receiver
	) => TimerId;
	clearTimer: (id: TimerId) => void;
	sendInitialMessage: (
		send: (data: string, id?: string) => void,
		clientId: string,
		lastTime: number | undefined
	) => void;
	onChange: undefined | ((kind: ChangeKind) => void);
};

const STREAMER_CHANGE = {
	idle: 0,
	running: 1,
	messageSent: 2,
} as const;

type ChangeKind = (typeof STREAMER_CHANGE)[keyof typeof STREAMER_CHANGE];

function removeReceiver(core: Core, receiver: Receiver) {
	const lastSize = core.receivers.size;
	const result = core.receivers.delete(receiver);
	if (!result) return false;

	if (lastSize === 1 && core.onChange) core.onChange(STREAMER_CHANGE.idle);
	return true;
}

function addReceiver(core: Core, receiver: Receiver) {
	// Check if unsubscribed already
	if (!receiver.openId) return;

	receiver.openId = undefined;
	core.sendInitialMessage(receiver.send, receiver.clientId, receiver.lastTime);

	const lastSize = core.receivers.size;
	core.receivers.add(receiver);

	if (lastSize < 1 && core.onChange) core.onChange(STREAMER_CHANGE.running);
}

const _core = Symbol('core');

export type Link = Pick<
	Core,
	| 'newClientIdHeaders'
	| 'schedule'
	| 'clearTimer'
	| 'sendInitialMessage'
	| 'onChange'
>;

class Streamer {
	[_core]: Core;

	constructor(link: Link) {
		this[_core] = {
			receivers: new Set<Receiver>(),
			newClientIdHeaders: link.newClientIdHeaders,
			schedule: link.schedule,
			clearTimer: link.clearTimer,
			sendInitialMessage: link.sendInitialMessage,
			onChange: link.onChange,
		};
	}

	add(send: Receiver['send'], maybeClientId: string | undefined, lastTime = 0) {
		const core = this[_core];

		const [clientId, headers] =
			maybeClientId && maybeClientId.length > 0
				? [maybeClientId, undefined]
				: core.newClientIdHeaders();

		const receiver: Receiver = {
			send,
			openId: undefined,
			clientId,
			lastTime,
		};

		const unregister = () => {
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

		receiver.openId = core.schedule(addReceiver, core, receiver);

		return {
			unregister,
			headers,
		};
	}

	send(data: string, id?: string) {
		const { onChange, receivers } = this[_core];
		if (receivers.size < 1) return;

		for (const rec of receivers) {
			rec.send(data, id);
		}
		if (onChange) onChange(STREAMER_CHANGE.messageSent);
	}
}

export { Streamer, STREAMER_CHANGE };
