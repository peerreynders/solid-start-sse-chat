
// import { all } from '../test/components/history-context/reference-count';
// import { all } from '../test/components/history-context/deadman-timer';
// import { all } from '../test/components/history-context/message-history';
// import { all } from '../test/server/sub/stream-yard';
// import { all } from '../test/server/sub/message-ring';
import { all } from '../test/server/sub/poll-yard';

import type { Runs } from './index';

function App(props: { runTests: (runs: Runs) => void }) {
	props.runTests(all());
	return null;
}

export { App };
