import { assertExists, Slot } from '@blocksuite/global/utils';
import * as Y from 'yjs';

import {
  BacklinkIndexer,
  BlockIndexer,
  type QueryContent,
  SearchIndexer,
} from '../indexer/index.js';
import { createMemoryStorage } from '../persistence/blob/memory-storage.js';
import type { BlobManager, BlobStorage } from '../persistence/blob/types.js';
import { sha } from '../persistence/blob/utils.js';
import type { DocProviderCreator } from '../providers/type.js';
import type { Schema } from '../schema/index.js';
import { serializeYDoc } from '../utils/jsx.js';
import {
  type AwarenessStore,
  docFromJSON,
  docToJSON,
  Text,
} from '../yjs/index.js';
import { type PageMeta, WorkspaceMeta } from './meta.js';
import { Page } from './page.js';
import { Store, type StoreOptions } from './store.js';

export type WorkspaceOptions = StoreOptions & {
  schema: Schema;
};

export class Workspace {
  static Y = Y;

  private _store: Store;

  private readonly _schema: Schema;
  private readonly _storages: BlobStorage[] = [];
  private readonly _blobStorage: BlobManager;

  meta: WorkspaceMeta;

  slots = {
    pagesUpdated: new Slot(),
    pageAdded: new Slot<string>(),
    pageRemoved: new Slot<string>(),
    // call this when a blob is updated, deleted or created
    //  workspace will update re-fetch the blob and update the page
    blobUpdate: new Slot<void>(),
  };

  indexer: {
    search: SearchIndexer;
    backlink: BacklinkIndexer;
  };

  constructor(storeOptions: WorkspaceOptions) {
    this._schema = storeOptions.schema;

    this._store = new Store(storeOptions);

    this._storages = (storeOptions.blobStorages ?? [createMemoryStorage]).map(
      fn => fn(storeOptions.id)
    );

    this._blobStorage = {
      get: async id => {
        let found = false;
        let count = 0;
        return new Promise(res => {
          this._storages.forEach(storage =>
            storage.crud
              .get(id)
              .then(result => {
                if (result && !found) {
                  found = true;
                  res(result);
                }
                if (++count === this._storages.length && !found) {
                  res(null);
                }
              })
              .catch(e => {
                console.error(e);
                if (++count === this._storages.length && !found) {
                  res(null);
                }
              })
          );
        });
      },
      set: async value => {
        const key = await sha(await value.arrayBuffer());
        await Promise.all(this._storages.map(s => s.crud.set(key, value)));
        return key;
      },
      delete: async key => {
        await Promise.all(this._storages.map(s => s.crud.delete(key)));
      },
      list: async () => {
        const keys = new Set<string>();
        await Promise.all(
          this._storages.map(async s => {
            const list = await s.crud.list();
            list.forEach(key => keys.add(key));
          })
        );
        return Array.from(keys);
      },
    };

    this.meta = new WorkspaceMeta(this.doc);
    this._bindPageMetaEvents();

    const blockIndexer = new BlockIndexer(this.doc, { slots: this.slots });
    this.indexer = {
      search: new SearchIndexer(this.doc),
      backlink: new BacklinkIndexer(blockIndexer),
    };
  }

  get id() {
    return this._store.id;
  }

  get isEmpty() {
    if (this.doc.store.clients.size === 0) return true;

    let flag = false;
    if (this.doc.store.clients.size === 1) {
      const items = [...this.doc.store.clients.values()][0];
      // workspaceVersion and pageVersion were set when we init the workspace
      if (items.length <= 2) {
        flag = true;
      }
    }
    return flag;
  }

  get awarenessStore(): AwarenessStore {
    return this._store.awarenessStore;
  }

  get providers() {
    return this._store.providers;
  }

  get blobs() {
    return this._blobStorage;
  }

  get pages() {
    return this._pages;
  }

  private get _pages() {
    // the meta space is not included
    return this._store.spaces as Map<`space:${string}`, Page>;
  }

  get doc() {
    return this._store.doc;
  }

  get idGenerator() {
    return this._store.idGenerator;
  }

  get schema() {
    return this._schema;
  }

  registerProvider(providerCreator: DocProviderCreator, id?: string) {
    return this._store.registerProvider(providerCreator, id);
  }

  private _hasPage(pageId: string) {
    return this._pages.has(`space:${pageId}`);
  }

  getPage(pageId: string): Page | null {
    const prefixedPageId = pageId.startsWith('space:')
      ? (pageId as `space:${string}`)
      : (`space:${pageId}` as const);

    return this._pages.get(prefixedPageId) ?? null;
  }

  private _bindPageMetaEvents() {
    this.meta.pageMetaAdded.on(pageId => {
      const page = new Page({
        id: pageId,
        workspace: this,
        doc: this.doc,
        awarenessStore: this.awarenessStore,
        idGenerator: this._store.idGenerator,
      });
      this._store.addSpace(page);
      this.slots.pageAdded.emit(page.id);
    });

    this.meta.pageMetasUpdated.on(() => this.slots.pagesUpdated.emit());

    this.meta.pageMetaRemoved.on(id => {
      const page = this.getPage(id) as Page;
      this._store.removeSpace(page);
      page.remove();
      this.slots.pageRemoved.emit(id);
    });
  }

  /**
   * By default, only an empty page will be created.
   * If the `init` parameter is passed, a `surface`, `note`, and `paragraph` block
   * will be created in the page simultaneously.
   */
  createPage(options: { id?: string } | string = {}) {
    // Migration guide
    if (typeof options === 'string') {
      options = { id: options };
      console.warn(
        '`createPage(pageId)` is deprecated, use `createPage()` directly or `createPage({ id: pageId })` instead'
      );
      console.warn(
        'More details see https://github.com/toeverything/blocksuite/pull/2272'
      );
    }
    // End of migration guide. Remove this in the next major version

    const { id: pageId = this.idGenerator() } = options;
    if (this._hasPage(pageId)) {
      throw new Error('page already exists');
    }

    this.meta.addPageMeta({
      id: pageId,
      title: '',
      createDate: +new Date(),
      tags: [],
    });
    return this.getPage(pageId) as Page;
  }

  /** Update page meta state. Note that this intentionally does not mutate page state. */
  setPageMeta(
    pageId: string,
    // You should not update subpageIds directly.
    props: Partial<PageMeta>
  ) {
    this.meta.setPageMeta(pageId, props);
  }

  removePage(pageId: string) {
    const pageMeta = this.meta.getPageMeta(pageId);
    assertExists(pageMeta);

    const page = this.getPage(pageId);
    if (!page) return;

    page.dispose();
    this.meta.removePageMeta(pageId);
    this._store.removeSpace(page);
  }

  search(query: QueryContent) {
    return this.indexer.search.search(query);
  }

  async importPageSnapshotV2(json: object, pageId: string) {
    const doc = docFromJSON(json);

    let page = this.getPage(pageId);
    if (page) {
      await page.waitForLoaded();
      page.clear();
    } else {
      page = this.createPage({ id: pageId });
      await page.waitForLoaded();
    }

    const update = Y.encodeStateAsUpdate(doc);

    Y.applyUpdate(page.spaceDoc, update);
    page.resetHistory();
  }

  exportPageSnapshotV2(pageId: string) {
    const page = this.getPage(pageId);
    assertExists(page, `page ${pageId} not found`);
    return docToJSON(page.spaceDoc);
  }

  /**
   * @internal
   * Import an object expression of a page.
   * Specify the page you want to update by passing the `pageId` parameter and it will
   * create a new page if it does not exist.
   */
  async importPageSnapshot(json: unknown, pageId: string) {
    const unprefix = (str: string) =>
      str.replace('sys:', '').replace('prop:', '').replace('space:', '');
    const visited = new Set();
    let page = this.getPage(pageId);
    if (page) {
      await page.waitForLoaded();
      page.clear();
    } else {
      page = this.createPage({ id: pageId });
      await page.waitForLoaded();
    }

    const sanitize = async (props: Record<string, unknown>) => {
      const result: Record<string, unknown> = {};

      // TODO: https://github.com/toeverything/blocksuite/issues/2939
      if (props['sys:flavour'] === 'affine:surface' && props['prop:elements']) {
        Object.values(props['prop:elements']).forEach(element => {
          const _element = element as Record<string, unknown>;
          if (_element['type'] === 'text') {
            const yText = new Y.Text();
            yText.applyDelta(_element['text']);
            _element['text'] = yText;
          }
          if (_element['type'] === 'frame') {
            const yText = new Y.Text();
            yText.applyDelta(_element['title']);
            _element['title'] = yText;
          }
          if (_element['type'] === 'shape' && _element['text']) {
            const yText = new Y.Text();
            yText.applyDelta(_element['text']);
            _element['text'] = yText;
          }
        });
      }

      // setup embed source
      if (props['sys:flavour'] === 'affine:image') {
        const maybeUrl = props['prop:sourceId'];
        if (typeof maybeUrl !== 'string') {
          throw new Error('Embed source is not a string');
        }
        if (maybeUrl.startsWith('http')) {
          try {
            const resp = await fetch(maybeUrl, {
              cache: 'no-cache',
              mode: 'cors',
              headers: {
                Origin: window.location.origin,
              },
            });
            const imgBlob = await resp.blob();
            if (!imgBlob.type.startsWith('image/')) {
              throw new Error('Embed source is not an image');
            }

            assertExists(page);
            const storage = page.blobs;
            assertExists(storage);
            props['prop:sourceId'] = (await storage.set(imgBlob)) as never;
          } catch (e) {
            console.error('Failed to fetch embed source');
            console.error(e);
          }
        }
      }

      if (props['sys:flavour'] === 'affine:database') {
        const columns = props['prop:columns'] as Record<string, string>[];
        const richTextColumns = columns.filter(
          cell => cell.type === 'rich-text'
        );

        const cells = props['prop:cells'] as Record<string, unknown>;
        richTextColumns.forEach(richText => {
          Object.keys(cells).forEach(key => {
            const cellValue = cells[key] as Record<string, unknown>;
            const richTextValue = cellValue[richText.id] as Record<
              string,
              unknown
            >;
            if (!richTextValue) return;
            if (Array.isArray(richTextValue.value)) {
              const yText = new Y.Text();
              yText.applyDelta(richTextValue.value);
              richTextValue.value = new Text(yText).yText;
            }
          });
        });
      }

      Object.keys(props).forEach(key => {
        if (key === 'sys:children' || key === 'sys:flavour') {
          return;
        }

        result[unprefix(key)] = props[key];
        if (key === 'prop:text' || key === 'prop:title') {
          const yText = new Y.Text();
          yText.applyDelta(props[key]);
          result[unprefix(key)] = new Text(yText);
        }
      });
      return result;
    };

    const { blocks } = json as Record<string, never>;
    assertExists(blocks, 'Snapshot structure is invalid');

    const addBlockByProps = async (
      page: Page,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props: any,
      parent?: string
    ) => {
      const id = props['sys:id'] as string;
      if (visited.has(id)) return;
      const sanitizedProps = await sanitize(props);
      page.addBlock(props['sys:flavour'], sanitizedProps, parent);
      await props['sys:children'].reduce(
        async (prev: Promise<unknown>, childId: string) => {
          await prev;
          await addBlockByProps(page, blocks[childId], id);
          visited.add(childId);
        },
        Promise.resolve()
      );
    };

    const root = Object.values(blocks).find(block => {
      const _block = block as Record<string, unknown>;
      const flavour = _block['sys:flavour'] as string;
      const schema = this.schema.flavourSchemaMap.get(flavour);
      return schema?.model?.role === 'root';
    });
    await addBlockByProps(page, root);
  }

  exportPageSnapshot(pageId: string) {
    const page = this.getPage(pageId);
    assertExists(page, `page ${pageId} not found`);
    return serializeYDoc(page.spaceDoc);
  }

  exportSnapshot() {
    return serializeYDoc(this.doc);
  }

  /**
   * @internal Only for testing
   */
  exportWorkspaceYDoc() {
    const binary = Y.encodeStateAsUpdate(this.doc);
    const file = new Blob([binary], { type: 'application/octet-stream' });
    const fileUrl = URL.createObjectURL(file);

    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = 'workspace.ydoc';
    link.click();

    URL.revokeObjectURL(fileUrl);
  }

  /**
   * @internal Only for testing
   */
  exportPageYDoc(pageId: string) {
    const pages = this.doc.getMap('spaces');
    const pageDoc = pages.get(`space:${pageId}`);

    if (!(pageDoc instanceof Y.Doc)) {
      throw new Error(`Page ${pageId} not found or not a Y.Doc`);
    }

    const binary = Y.encodeStateAsUpdate(pageDoc);
    const file = new Blob([binary], { type: 'application/octet-stream' });
    const fileUrl = URL.createObjectURL(file);

    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = 'workspace.ydoc';
    link.click();

    URL.revokeObjectURL(fileUrl);
  }

  /** @internal Only for testing */
  exportJSX(blockId?: string, pageId = this.meta.pageMetas.at(0)?.id) {
    assertExists(pageId);
    return this._store.exportJSX(pageId, blockId);
  }
}
