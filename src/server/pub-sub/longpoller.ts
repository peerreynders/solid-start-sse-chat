// file: src/server/pub-sub/longpoller.ts

type Poll = {
	close: (data: string, headers?: Record<string, string>) => void;
	clientId: string;
	lastTime: number;
	arrived: number;
	messages: number;
};

type TimerId = ReturnType<typeof setTimeout>;

type Core = {
	polls: Set<Poll>;
	nextSweep: number;
	timer: TimerId | undefined;
	respondChat: (
		close: (data: string, headers?: Record<string, string>) => void,
		lastTime: number
	) => void;
	respondKeepAlive: (
		close: (data: string, headers?: Record<string, string>) => void
	) => void;
	respondWelcome: (
		close: (data: string, headers?: Record<string, string>) => void,
		maybeClientId: string | undefined
	) => void;
	minMs: number;
	maxMs: number;
	timeMs: () => number;
	clearTimer: () => void;
	setTimer: (delay: number) => void;
};

function stop(core: Core) {
	if (!core.timer) return;

	core.clearTimer();
	core.nextSweep = 0;
}

const pollRespondBy = (core: Core, poll: Poll) =>
	poll.arrived + (poll.messages < 1 ? core.maxMs : core.minMs);

function scheduleSweep(core: Core) {
	if (core.polls.size < 1) return stop(core);

	// Given: polls are iterated in insertion order
	// i.e. poll.arrived increases.
	const polls = core.polls.values();
	let result: IteratorResult<Poll> = polls.next();
	let respondBy = pollRespondBy(core, result.value);
	for (result = polls.next(); !(result?.done ?? false); result = polls.next()) {
		const p = result.value;
		if (p.arrived > respondBy) break;

		const releaseTime = pollRespondBy(core, p);
		if (releaseTime < respondBy) respondBy = releaseTime;
	}

	const now = core.timeMs();
	// nothing to do if response time in the future
	// and next sweep coincides.
	if (now < respondBy && core.nextSweep === respondBy) return;

	core.clearTimer();
	core.nextSweep = respondBy;
	core.setTimer(core.nextSweep - now);
}

function sweep(core: Core) {
	// Invoked via setTimeout only so no need to clearTimer
	core.timer = undefined;
	core.nextSweep = 0;

	const now = core.timeMs();
	const cutoff = now - core.minMs;
	for (const poll of core.polls) {
		if (cutoff < poll.arrived) break;

		if (now < pollRespondBy(core, poll)) continue;

		core.polls.delete(poll);
		if (poll.messages < 1) core.respondKeepAlive(poll.close);
		else core.respondChat(poll.close, poll.lastTime);
	}

	scheduleSweep(core);
}

const _core = Symbol('core');

export type Link = Pick<
	Core,
	| 'respondChat'
	| 'respondKeepAlive'
	| 'respondWelcome'
	| 'minMs'
	| 'maxMs'
	| 'timeMs'
> & {
	clearTimer: (id: TimerId) => void;
	setTimer: (cb: (arg: Core) => void, delay: number, arg: Core) => TimerId;
};

class Longpoller {
	[_core]: Core;

	constructor(link: Link) {
		const setTimer = link.setTimer;
		const clearTimer = link.clearTimer;

		const core: Core = {
			polls: new Set<Poll>(),
			nextSweep: 0,
			timer: undefined,
			respondChat: link.respondChat,
			respondKeepAlive: link.respondKeepAlive,
			respondWelcome: link.respondWelcome,
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
			core.respondChat(poll.close, poll.lastTime);
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
			core.respondWelcome(close, clientId);

			return undefined;
		}

		const poll: Poll = {
			close,
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
