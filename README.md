# SolidStart SSE Chat
Basic Chat demonstration with [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) (SSE) for server to client communication. (Uses [this workaround](https://github.com/peerreynders/solid-start-sse-counter) so that the Node.js server can detect when the client closes the SSE request.)

If HTTP/1.1 compatibility is desired a client application shouldn't use more that one SSE connection as there is a limit of 6 connections per domain on a browser (the limit is significantly higher with HTTP/2). Typically SSE is less resource intensive compared to [WebSockets](https://datatracker.ietf.org/doc/html/rfc6455) (which aren't part of the HTTP spec either). 

With HTTP/3 both will likely be replaced with [WebTransport](https://www.w3.org/TR/webtransport/) ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API), [web.dev](https://developer.chrome.com/articles/webtransport/)).

For [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)s the [HTML Living Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#authoring-notes) recommends:

> Clients that support HTTP's per-server connection limitation might run into trouble **when opening multiple pages from a site if each page has an `EventSource` to the same domain**. Authors can avoid this using the relatively complex mechanism of using unique domain names per connection, or by allowing the user to enable or disable the `EventSource` functionality on a per-page basis, or by sharing a single `EventSource` object using a [shared worker](https://html.spec.whatwg.org/multipage/workers.html#sharedworkerglobalscope). 

From that perspective it's likely a mistake to create an `EventSource` inside an ordinary component as it may be construed from [the remix-utils `useEventSource()` example](https://github.com/remix-run/examples/blob/c59ee8eb2b06002b22d53e91df48a0b77b49091c/sse-counter/app/root.tsx) (the example *does* actually only use it in the top-level `App` component though that detail is easily missed.).

Here the `EventSource` is centrally handled in [`message-context`](./src/components/message-context.tsx) where the messages are processed into a [store](https://www.solidjs.com/docs/latest/api#using-stores) which itself is made accessible via a [context](https://www.solidjs.com/docs/latest/api#createcontext) to the rest of the application.

Ideally in a larger application with multiple server-to-client information streams, the streams should be multiplexed onto a single SSE connection and demultiplexed client-side into the appropriate parts of client state. 

```shell
$ cd solid-start-sse-chat
$ npm i

added 480 packages, and audited 481 packages in 4s

$ npm run dev

> solid-start-sse-chat@0.0.0 dev
> solid-start dev

 solid-start dev 
 version  0.2.26
 adapter  node

  VITE v4.3.9  ready in 564 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
  ➜  Inspect: http://localhost:3000/__inspect/
  ➜  press h to show help

  ➜  Page Routes:
     ┌─ http://localhost:3000/*404
     └─ http://localhost:3000/

  ➜  API Routes:
     None! 👻

  > Server modules: 
   http://localhost:3000/_m/*

GET http://localhost:3000/
GET http://localhost:3000/_m/src/components/message-context.tsx/0/stream
POST http://localhost:3000/_m/src/routes/index.tsx/0/sending
```

```
$ npm run build

> solid-start-sse-chat@0.0.0 build
> solid-start build

 solid-start build 
 version  0.2.26
 adapter  node

solid-start building client...
vite v4.3.9 building for production...
✓ 64 modules transformed.

dist/public/manifest.json                     0.62 kB │ gzip:  0.22 kB
dist/public/ssr-manifest.json                 2.10 kB │ gzip:  0.50 kB
dist/public/assets/_...404_-50f74a48.js       0.55 kB │ gzip:  0.37 kB
dist/public/assets/index-371eb851.js          5.34 kB │ gzip:  2.44 kB
dist/public/assets/entry-client-e4e12076.js  49.64 kB │ gzip: 19.05 kB
✓ built in 1.40s
solid-start client built in: 1.422s

solid-start building server...
vite v4.3.9 building SSR bundle for production...
✓ 62 modules transformed.

.solid/server/manifest.json     0.12 kB
.solid/server/entry-server.js  89.36 kB
✓ built in 811ms
solid-start server built in: 836.949ms


> solid-start-sse-chat@0.0.0 postbuild
> sed -i 's/assets_handler).use(comp/assets_handler).use(solidStartSseSupport).use(comp/g' dist/server.js

$ npm run start

> solid-start-sse-chat@0.0.0 start
> solid-start start

 solid-start start 
 version  0.2.26
 adapter  node


  ➜  Page Routes:
     ┌─ http://localhost:3000/*404
     └─ http://localhost:3000/

  ➜  API Routes:
     None! 👻

Listening on port 3000
```

--- 

To force the application to use the [long polling](https://javascript.info/long-polling#long-polling) fallback [instead of SSE](./src/components/message-context.tsx):

```TypeScript
// file: src/components/message-context
// …

// Use `if(info.streamed === undefined) {` to force error to switch to long polling fallback
if (info.streamed) {

// …
```
