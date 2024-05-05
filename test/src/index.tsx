/* @refresh reload */
import { render } from 'solid-js/web';

import './index.css';
import { App } from './app';

// --- uvub ---
import { configure, exec } from 'uvub';
import {
	UVUB_REPORT_READY,
	UvubReport,
	UvubReportReadyEvent,
} from 'uvub/report';

const listener: EventListenerObject = {
	handleEvent(event: Event) {
		console.log(event);
		if (
			event.type === UVUB_REPORT_READY &&
			event instanceof UvubReportReadyEvent
		) {
			configure({
				reporter: event.reporter,
				interval: 20,
				bail: false,
				autorun: false,
			});
		}
	},
};

export type Runs = (() => void) | Runs[];

function runTests(runs: Runs) {
	// schedule test execution
	const hold: [number, Runs][] = [];
	for (let index = 0, next = runs; ; ) {
		if (typeof next === 'object') {
			if (next.length > index) {
				const item = next[index];
				if (typeof item !== 'object') {
					// 1. A run inside array; run it and advance
					item();
					index += 1;
				} else {
					// 2. An array inside array;
					//    put next item in current array on hold and
					//    iterate on new array (i.e. depth first)
					hold.push([index + 1, next]);
					next = item;
					index = 0;
				}
			}
		} else {
			// 3. Just a run.
			next();
		}

		if (typeof next === 'function' || index >= next.length) {
			const tuple = hold.pop();
			if (!tuple) break;

			[index, next] = tuple;
		}
	}

	// execute all scheduled tests (automatic with `autorun: true`)
	exec().then((withErrors) =>
		console.log(`exec() finished withErrors: ${withErrors}`)
	);
}

document.addEventListener(UVUB_REPORT_READY, listener, {
	once: true,
});

if (window && 'customElements' in window) {
	if (!customElements.get('uvub-report'))
		customElements.define('uvub-report', UvubReport);
}

// --- SolidJS ---

const root = document.getElementById('root');

if (!(root instanceof HTMLElement)) {
	throw new Error(
		'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got mispelled?'
	);
}

render(() => <App runTests={runTests} />, root!);
