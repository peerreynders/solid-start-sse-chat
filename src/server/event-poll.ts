// file: src/server/event-poll.ts
import { IncomingMessage } from 'node:http';

export type PollController = {
	close: (data: string) => void;
	cancel: () => void;
};

type InitSource = (controller: PollController) => () => void;

function makeEventPoll(request: IncomingMessage, init: InitSource) {
	// listen to the request closing ASAP
	let cleanup: (() => void) | undefined;
	let closePoll: ((data?: string) => void) | undefined;
	let onClientClose: (() => void) | undefined = () => {
		if (onClientClose) {
			request.removeListener('close', onClientClose);
			onClientClose = undefined;
		}
		closePoll?.();
	};
	request.addListener('close', onClientClose);

	return new Promise<string | null>((resolve) => {
		closePoll = (data?: string) => {
			if (onClientClose) request.removeListener('close', onClientClose);

			onClientClose = undefined;
			// Call cleanup passed from initilization
			if (!cleanup) return;

			cleanup();
			cleanup = undefined;
			resolve(data ? data : null);
		};

		cleanup = init({
			close: (data: string) => closePoll?.(data),
			cancel: () => closePoll?.(),
		});
	});
}

export { makeEventPoll };
