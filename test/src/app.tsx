//import { all } from '../test/server/pub-sub/longpoller';
//import { all } from '../test/server/pub-sub/streamer';
//import { all } from '../test/components/history-context/message-history';
//import { all } from '../test/components/history-context/longpoller';

// import { all } from '../test/components/history-context/reference-count';
import { all } from '../test/components/history-context/deadman-timer';

import type { Runs } from './index';

function App(props: { runTests: (runs: Runs) => void }) {
	props.runTests(all());
	return null;
}

export { App };
