type Poll = {
	close: (data: string, headers?: Record<string, string>) => void;
	clientId: string;
	lastTime: number;
	arrived: number;
	messages: number;
};

type Core<T> = {
	polls: Set<Poll>;
	nextSweep: number;
	timer: T | undefined;
	makeChat: (lastTime: number) => string;
	makeKeepAlive: () => string;
	makeWelcome: (
		clientId: string | undefined
	) => [message: string, headers: Record<string, string> | undefined];
	minMs: number;
	maxMs: number;
	timeMs: () => number;
	clearTimer: () => void;
	setTimer: (delay: number) => void;
};

function stop<T>(core: Core<T>) {
	if (!core.timer) return;

	core.clearTimer();
	core.nextSweep = 0;
}

function scheduleSweep<T>(core: Core<T>) {
	if (core.polls.size < 1) return stop(core);

	// First (and least recently added) poll
	const head = core.polls.values().next().value as Poll;
	// no messages since then wait maximum; otherwise minimum
	const respondBy =
		head.arrived + (head.messages < 1 ? core.maxMs : core.minMs);
	const now = core.timeMs();

	// nothing to do if response time in the future
	// and next sweep coincides.
	if (now < respondBy && core.nextSweep === respondBy) return;

	core.clearTimer();
	core.nextSweep = respondBy;
	core.setTimer(core.nextSweep - now);
}

function sweep<T>(core: Core<T>) {
	// Invoked via setTimeout only so no need to clearTimer
	core.timer = undefined;
	core.nextSweep = 0;

	const now = core.timeMs();
	// reuse the same keepAlive message
	let keepAlive: string | undefined;
	for (const poll of core.polls) {
		// First poll that doesn't need to be released
		// then no need to go further
		if (
			now < poll.arrived + core.minMs ||
			(now < poll.arrived + core.maxMs && poll.messages < 1)
		)
			break;

		core.polls.delete(poll);
		const message =
			poll.messages < 1
				? keepAlive
					? keepAlive
					: (keepAlive = core.makeKeepAlive())
				: core.makeChat(poll.lastTime);

		poll.close(message);
	}

	scheduleSweep(core);
}

const _core = Symbol('core');

export type Link<T> = Pick<
	Core<T>,
	'makeChat' | 'makeKeepAlive' | 'makeWelcome' | 'minMs' | 'maxMs' | 'timeMs'
> & {
	clearTimer: (id: T) => void;
	setTimer: (cb: (arg: Core<T>) => void, delay: number, arg: Core<T>) => T;
};

class Longpoller<T> {
	[_core]: Core<T>;

	constructor(link: Link<T>) {
		const setTimer = link.setTimer;
		const clearTimer = link.clearTimer;

		const core: Core<T> = {
			polls: new Set<Poll>(),
			nextSweep: 0,
			timer: undefined,
			makeChat: link.makeChat,
			makeKeepAlive: link.makeKeepAlive,
			makeWelcome: link.makeWelcome,
			minMs: link.minMs,
			maxMs: link.maxMs,
			timeMs: link.timeMs,
			clearTimer: () => {
				if (!core.timer) return;
				clearTimer(core.timer);
				core.timer = undefined;
			},
			setTimer: (delay: number) => {
				core.timer = setTimer(sweep, delay, core);
			},
		};

		this[_core] = core;
	}

	markMessage() {
		const core = this[_core];
		const now = core.timeMs();
		for (const poll of core.polls) {
			poll.messages += 1;
			if (now <= poll.arrived + core.minMs) continue;

			core.polls.delete(poll);
			poll.close(core.makeChat(poll.lastTime));
		}
		scheduleSweep(core);
	}

	add(
		close: Poll['close'],
		clientId: string | undefined,
		lastTime = 0,
		messages = 0
	) {
		const core = this[_core];
		if (lastTime === 0 || !clientId) {
			const [message, headers] = core.makeWelcome(clientId);
			close(message, headers);

			return undefined;
		}

		const poll: Poll = {
			close: close,
			clientId: clientId,
			lastTime,
			arrived: core.timeMs(),
			messages,
		};

		const unregister = () => {
			core.polls.delete(poll);
			scheduleSweep(core);
		};

		core.polls.add(poll);
		scheduleSweep(core);

		return unregister;
	}
}

export { Longpoller };
