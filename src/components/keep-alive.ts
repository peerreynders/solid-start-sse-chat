type TimerId = ReturnType<typeof setTimeout>;

type Core = {
	actionId: TimerId | undefined;
	lastTime: number;
	actionMs: number;
	action: () => void;
	timeMs: () => number;
	schedule: (fn: (core: Core) => void, delayMs: number, core: Core) => TimerId;
	clearTimer: (id: TimerId) => void;
};

function keepAlive(core: Core) {
	const delay = core.actionMs - (core.timeMs() - core.lastTime);
	if (delay > 0) {
		core.actionId = core.schedule(keepAlive, delay, core);
		return;
	}

	core.actionId = undefined;
	core.action();
}

const _core = Symbol('core');

export type Link = Pick<
	Core,
	'actionMs' | 'action' | 'timeMs' | 'schedule' | 'clearTimer'
>;

class KeepAlive {
	[_core]: Core;

	constructor(link: Link) {
		this[_core] = {
			actionId: undefined,
			lastTime: 0,
			actionMs: link.actionMs,
			action: link.action,
			timeMs: link.timeMs,
			schedule: link.schedule,
			clearTimer: link.clearTimer,
		};
	}

	start() {
		const core = this[_core];
		core.lastTime = core.timeMs();

		if (core.actionId) return;

		core.actionId = core.schedule(keepAlive, core.actionMs, core);
	}

	stop() {
		const core = this[_core];

		if (!core.actionId) return;

		core.clearTimer(core.actionId);
		core.actionId = undefined;
	}
}

export { KeepAlive };
