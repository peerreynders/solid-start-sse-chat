import { MetaProvider, Title } from '@solidjs/meta';
import { Router } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';
import { Suspense } from 'solid-js';
import { HistoryProvider } from './components/history-context';

export default function App() {
	return (
		<Router
			root={(props) => (
				<MetaProvider>
					<Title>SolidStart - SSE Chat</Title>
					<HistoryProvider>
						<Suspense>{props.children}</Suspense>
					</HistoryProvider>
				</MetaProvider>
			)}
		>
			<FileRoutes />
		</Router>
	);
}
