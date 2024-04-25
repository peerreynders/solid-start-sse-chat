// file: src/app-store.ts
// Store for "app state" that needs to be accessible during client
// side operation and isolated during SSR

import { isServer, getRequestEvent } from 'solid-js/web';

import type { Context } from 'solid-js';
import type { HistoryReturn } from './types';

// 1. Add symbol key
const keyHistoryStore = Symbol('history-store');

// 2. Add value type
export type AppStore = {
	[keyHistoryStore]: {
		props:
			| {
					context: Context<HistoryReturn[0]>;
					incrementCount: () => void;
					decrementCount: () => void;
					historyAccess: HistoryReturn[0];
			  }
			| undefined;
	};
};

let appStore: AppStore | undefined;

// 3. Add initial value
export function makeAppStore(): AppStore {
	return {
		[keyHistoryStore]: {
			props: undefined,
		},
	};
}

function getStore() {
	if (isServer) {
		const event = getRequestEvent();
		if (!event) throw Error('RequestEvent not available yet');
		const store = event.locals.appStore;
		if (!store) throw Error('AppStore missing. Should be added by middleware');
		return store;
	}

	return appStore ?? (appStore = makeAppStore());
}

// 4. Add selector
export const getHistoryStore = () => getStore()[keyHistoryStore];
