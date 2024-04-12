import { MetaProvider, Title } from '@solidjs/meta';
import { Router } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';
import { Suspense } from 'solid-js';
import { MessageProvider } from './components/message-context';

export default function App() {
	return (
		<Router
			root={(props) => (
				<MetaProvider>
					<Title>SolidStart - SSE Chat</Title>
					<MessageProvider>
						<Suspense>{props.children}</Suspense>
					</MessageProvider>
				</MetaProvider>
			)}
		>
			<FileRoutes />
		</Router>
	);
}
