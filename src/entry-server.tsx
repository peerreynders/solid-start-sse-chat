// file: src/entry-server.tsx
import { createHandler, StartServer } from '@solidjs/start/server';
import type { AppStore } from './app-store';

declare module '@solidjs/start/server' {
	interface RequestEventLocals {
		appStore: AppStore;
		clientId: string;
	}
}

export default createHandler(() => (
	<StartServer
		document={({ assets, children, scripts }) => (
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<link rel="icon" href="/favicon.ico" />
					<link rel="stylesheet" href="styles.css" as="style" />
					{assets}
				</head>
				<body>
					<div id="app">{children}</div>
					{scripts}
				</body>
			</html>
		)}
	/>
));
