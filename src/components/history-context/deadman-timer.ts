// file: src/components/history-context/deadman-timer.ts

type Core<Tid> = {
	actionId: Tid | undefined;
	lastTime: number;
	actionMs: number;
	action: () => void;
	timeMs: () => number;
	schedule: (
		fn: (core: Core<Tid>) => void,
		delayMs: number,
		core: Core<Tid>
	) => Tid;
	clearTimer: (id: Tid) => void;
};

// This function **will** run
// The difference is whether or not `start` was called
// recently enough. If it was the function simply reschedules itself
// Otherwise it invokes the action and stops
//
function keepAlive<Tid>(core: Core<Tid>) {
	const delay = core.actionMs - (core.timeMs() - core.lastTime);
	if (delay > 0) {
		core.actionId = core.schedule(keepAlive, delay, core);
		return;
	}

	core.actionId = undefined;
	core.action();
}

export type Link<Tid> = Pick<
	Core<Tid>,
	'actionMs' | 'action' | 'timeMs' | 'schedule' | 'clearTimer'
>;

class DeadmanTimer<Tid> {
	// Implemented as properties rather than methods
	// so we can pass around the functions without
	// giving access to the whole object
	readonly start: () => void;
	readonly stop: () => void;

	constructor(link: Link<Tid>) {
		const core: Core<Tid> = {
			actionId: undefined,
			lastTime: 0,
			actionMs: link.actionMs,
			action: link.action,
			timeMs: link.timeMs,
			schedule: link.schedule,
			clearTimer: link.clearTimer,
		};

		this.start = () => {
			core.lastTime = core.timeMs();

			// Just let keepAlive run
			if (core.actionId) return;

			core.actionId = core.schedule(keepAlive, core.actionMs, core);
		};

		this.stop = () => {
			if (!core.actionId) return;

			core.clearTimer(core.actionId);
			core.actionId = undefined;
		};
	}
}

export { DeadmanTimer };
