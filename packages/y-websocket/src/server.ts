import 'async-call-rpc/utils/node/websocket.server.js';

import { parse } from 'node:url';

import type { PassiveDocProvider } from '@blocksuite/store';
import { Workspace } from '@blocksuite/store';
import { createAsyncCallRPCProviderCreator } from '@blocksuite/store/providers/async-call-rpc';
import type { EventBasedChannel } from 'async-call-rpc';
import { BSON_Serialization } from 'async-call-rpc/utils/node/bson.js';
import { deserialize, serialize } from 'bson';
import { createServer } from 'http';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import type { Doc } from 'yjs';

const createServerProvider = (pathname: string) => {
  const wss = new WebSocketServer({
    noServer: true,
  });

  const channel = new Promise<EventBasedChannel>(resolve => {
    const wsSet = new Set<WebSocket>();

    const docGuidSet = new Set<string>();
    const registerServerDocUpdate = (doc: Doc) => {
      if (!docGuidSet.has(doc.guid)) {
        docGuidSet.add(doc.guid);

        doc.on('update', update => {
          const p = provider as any;
          // distribute update to clients
          p._rpc.sendUpdateDoc(doc.guid, update);
        });
      }

      doc.subdocs.forEach(doc => registerServerDocUpdate(doc));
    };

    registerServerDocUpdate(doc.doc);

    wss.on('connection', ws => {
      wsSet.add(ws);
    });
    resolve({
      on(callback) {
        const cb = (data: unknown) => {
          callback(data);
        };
        wsSet.forEach(
          // @ts-ignore
          ws => !ws._init && ws.on('message', cb) && (ws._init = true)
        );

        return () => {
          // @ts-ignore
          wsSet.forEach(ws => ws._init && ws.off('message', cb));
          wsSet.clear();
        };
      },
      send(data: unknown) {
        wsSet.forEach(ws => ws.send(data as never));
      },
    });
  });
  const providerCreator = createAsyncCallRPCProviderCreator(
    'websocket-server',
    channel,
    {
      cleanup: () => {
        server.close();
      },
      asyncCallOptions: {
        log: 'all',
        serializer: BSON_Serialization({
          serialize,
          deserialize,
        }),
      },
    }
  );
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const doc = docMap.get(pathname)!;
  const provider = providerCreator(doc.id, doc.doc, {
    awareness: doc.awarenessStore.awareness,
  }) as PassiveDocProvider;
  return {
    wss,
    provider,
  };
};

const docMap = new Map<string, Workspace>();
const docProviderMap = new Map<
  string,
  ReturnType<typeof createServerProvider>
>();

const server = createServer();
server.on('upgrade', function upgrade(request, socket, head) {
  if (!request.url) {
    socket.destroy();
    return;
  }
  const { pathname } = parse(request.url);
  if (!pathname) {
    socket.destroy();
    return;
  }

  if (!docMap.has(pathname)) {
    docMap.set(
      pathname,
      new Workspace({
        id: pathname,
        isSSR: true,
        providerCreators: [],
      })
    );
  }

  if (!docProviderMap.has(pathname)) {
    docProviderMap.set(pathname, createServerProvider(pathname));
  }

  const {
    wss,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  } = docProviderMap.get(pathname)!;

  wss.handleUpgrade(request, socket, head, function done(ws: WebSocket) {
    wss.emit('connection', ws, request);
  });
});

server.listen(8081);
