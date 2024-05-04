// file: src/server/sub/poll-yard.ts
type Poll = {
	close: () => void;
	id: string;
	arrived: number;
	count: number;
};

type Core<T> = {
	polls: Map<string,Poll>;
	timer: T | undefined;
	nextSweep: number;
	maxMs: number;
	minMs: number;
	clearTimer: (id: T | undefined) => void;
	setTimer: (cb: (c: Core<T>) => void, delay: number, c: Core<T>) => T;
	timeMs: () => number;
	stop: () => void;
}

const pollRespondBy = <T>(core: Core<T>, poll: Poll) =>
	poll.arrived + (poll.count < 1 ? core.maxMs : core.minMs);

function scheduleSweep<T>(core: Core<T>) {
	if (core.polls.size < 1) return core.stop();

	// Given: polls are iterated in insertion order
	// i.e. poll.arrived increases.
	const polls = core.polls.values();
	let result: IteratorResult<Poll> = polls.next();
	let respondBy = pollRespondBy(core, result.value);

	// Looking for the most urgent `respondBy`
	for (result = polls.next(); !(result?.done ?? false); result = polls.next()) {
		const p = result.value;
		// If poll arrived after current `respondBy` 
		// no need to look any further
		if (p.arrived > respondBy) break;

		// Swap if this `respondBy` is more urgent
		const releaseTime = pollRespondBy(core, p);
		if (releaseTime < respondBy) respondBy = releaseTime;
	}

	const now = core.timeMs();
	// nothing to do if response time in the future
	// and next sweep coincides.
	if (now < respondBy && core.nextSweep === respondBy) return;

	core.clearTimer(core.timer);
	core.nextSweep = respondBy;
	core.timer = core.setTimer(sweep, core.nextSweep - now, core);
}

function sweep<T>(core: Core<T>) {
	// Invoked via setTimeout only 
	// so no need to clearTimer
	core.timer = undefined;
	core.nextSweep = 0;

	const now = core.timeMs();
	const cutoff = now - core.minMs;
	for (const poll of core.polls.values()) {
		if (cutoff < poll.arrived) break;

		if (now < pollRespondBy(core, poll)) continue;

		core.polls.delete(poll.id);
		poll.close();
	}

	scheduleSweep(core);
}

type Link<T> = Pick<
	Core<T>,
	| 'minMs'
	| 'maxMs'
	| 'clearTimer'
	| 'setTimer'
	| 'timeMs'
>; 

class PollYard<T> {
  readonly add: (close: () => void, id: string,  messageCount: number) => void;
	readonly mark: (messageCount: number) => void;
	readonly unsubscribe: (id: string) => boolean;

	constructor({ maxMs, minMs, clearTimer, setTimer, timeMs } : Link<T>) {
		const core: Core<T> = {
			polls: new Map(),
			timer: undefined,
			nextSweep: 0,
			maxMs,
			minMs,
			clearTimer,
			setTimer,
			timeMs,
			stop: () => {
				if (!core.timer) return;

				core.clearTimer(core.timer);
				core.timer = undefined;
				core.nextSweep = 0;
			}
		};

		this.add = (close, id, count) => {
			const poll = {
				close,
				id,
				count,
				arrived: core.timeMs()
			};
			core.polls.set(poll.id, poll);

			scheduleSweep(core)
		}

		this.mark = (messageCount) => {
			const now = core.timeMs();
			// release all polls that were waiting 
			// for a message and have passed the
			// minimum wait.
			for (const poll of core.polls.values()) {
				poll.count += messageCount;
				if (now <= poll.arrived + core.minMs) continue;

				core.polls.delete(poll.id);
				poll.close();
			}

			scheduleSweep(core);
		}

		this.unsubscribe = (id: string) => {
			console.log('PollYard unsubscribe', id, core.polls.size);
			const lastSize = core.polls.size;
			const result = core.polls.delete(id);
			if (!result) return false;

		 	if (lastSize === 1) core.stop()
		 	else scheduleSweep(core);

			return true;
		}
	}
}

export { PollYard };
