// related component
import './common/group-by/define.js';
import './common/header/views.js';
import './common/header/title.js';
import './common/header/tools/tools.js';
import './table/define.js';
import './table/renderer.js';
import './kanban/define.js';
import './kanban/renderer.js';

import { PathFinder } from '@blocksuite/block-std';
import { Slot } from '@blocksuite/global/utils';
import { BlockElement } from '@blocksuite/lit';
import { css, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { keyed } from 'lit/directives/keyed.js';
import { createRef } from 'lit/directives/ref.js';
import { html } from 'lit/static-html.js';

import type { DataSource } from '../__internal__/datasource/base.js';
import { DatabaseBlockDatasource } from '../__internal__/datasource/database-block-datasource.js';
import type { DataViewSelectionState } from '../__internal__/index.js';
import { renderUniLit } from '../components/uni-component/uni-component.js';
import type { BaseDataView } from './common/base-data-view.js';
import { dataViewCssVariable } from './common/css-variable.js';
import {
  type DataViewExpose,
  viewRendererManager,
} from './common/data-view.js';
import type { DataViewManager } from './common/data-view-manager.js';
import { DatabaseSelection } from './common/selection.js';
import type { ViewSource } from './common/view-source.js';
import type { DatabaseBlockModel } from './database-model.js';
import { KanbanViewClipboard } from './kanban/clipboard.js';
import { DataViewKanbanManager } from './kanban/kanban-view-manager.js';
import { TableViewClipboard } from './table/clipboard.js';
import { DataViewTableManager } from './table/table-view-manager.js';

type ViewData = {
  view: DataViewManager;
  viewUpdated: Slot;
  selectionUpdated: Slot<DataViewSelectionState>;
  setSelection: (selection?: DataViewSelectionState) => void;
  bindHotkey: BaseDataView['bindHotkey'];
  handleEvent: BaseDataView['handleEvent'];
};

@customElement('affine-database')
export class DatabaseBlockComponent extends BlockElement<DatabaseBlockModel> {
  static override styles = css`
    ${unsafeCSS(dataViewCssVariable('affine-database'))}
    affine-database {
      display: block;
      border-radius: 8px;
      background-color: var(--affine-background-primary-color);
      padding: 8px;
      margin: 8px -8px -8px;
    }
    .database-block-selected {
      background-color: var(--affine-hover-color);
      border-radius: 4px;
    }
  `;
  override connectedCallback() {
    super.connectedCallback();
    this._disposables.add(
      this.root.selectionManager.slots.changed.on(selections => {
        const databaseSelection = selections.find(
          (selection): selection is DatabaseSelection => {
            if (!PathFinder.equals(selection.path, this.path)) {
              return false;
            }
            return selection instanceof DatabaseSelection;
          }
        );
        Object.entries(this.viewMap).forEach(([id, v]) => {
          if (!databaseSelection || databaseSelection.viewId !== id) {
            v.selectionUpdated.emit(undefined);
            return;
          }
          v.selectionUpdated.emit(databaseSelection?.viewSelection);
        });
      })
    );
    this._disposables.add(
      this.model.propsUpdated.on(() => {
        this.model.views.forEach(v => {
          this.viewMap[v.id]?.viewUpdated.emit();
        });
      })
    );
    this.handleEvent('selectionChange', () => {
      const selection = this.service?.selectionManager.value.find(selection =>
        PathFinder.equals(selection.path, this.path)
      );
      return !!selection;
    });
    requestAnimationFrame(() => {
      this.requestUpdate();
    });
  }

  override firstUpdated() {
    requestAnimationFrame(() => {
      this.requestUpdate();
    });
  }

  @property({ attribute: false })
  modalMode?: boolean;

  @state()
  currentView?: string;

  private _view = createRef<DataViewExpose>();

  _setViewId = (viewId: string) => {
    if (this.currentView !== viewId) {
      this.service?.selectionManager.setGroup('note', []);
      requestAnimationFrame(() => {
        this.currentView = viewId;
        requestAnimationFrame(() => {
          this.requestUpdate();
        });
      });
    }
  };

  private _dataSource?: DataSource;
  public get dataSource(): DataSource {
    if (!this._dataSource) {
      this._dataSource = new DatabaseBlockDatasource(this.root, {
        type: 'database-block',
        pageId: this.root.page.id,
        blockId: this.model.id,
      });
    }
    return this._dataSource;
  }

  private viewMap: Record<string, ViewData> = {};
  private getViewDataById = (id: string) => {
    return this.model.views.find(v => v.id === id);
  };

  public focusFirstCell = () => {
    this._view.value?.focusFirstCell();
  };

  private viewSource(id: string, viewUpdated: Slot): ViewSource {
    const getViewDataById = this.getViewDataById;
    return {
      get view() {
        const view = getViewDataById(id);
        if (!view) {
          throw new Error(`view ${id} not found`);
        }
        return view as never;
      },
      updateView: updater => {
        this.model.updateView(id, updater as never);
      },
      delete: () => {
        this.model.deleteView(id);
        this.model.applyColumnUpdate();
      },
      isDeleted: () => {
        return !getViewDataById(id);
      },
      updateSlot: viewUpdated,
    };
  }

  private getView(id: string): ViewData {
    if (!this.viewMap[id]) {
      const viewUpdated = new Slot();
      const view = new {
        table: DataViewTableManager,
        kanban: DataViewKanbanManager,
      }[this.getViewDataById(id)?.mode ?? 'table'](
        this.viewSource(id, viewUpdated) as never,
        this.dataSource
      );
      this.viewMap[id] = {
        view: view,
        viewUpdated,
        selectionUpdated: new Slot<DataViewSelectionState>(),
        setSelection: selection => {
          if (!selection) {
            this.root.selectionManager.setGroup('note', []);
            return;
          }
          const data = this.root.selectionManager.getInstance('database', {
            path: this.path,
            viewSelection: selection as never,
          });
          this.root.selectionManager.setGroup('note', [data]);
        },
        handleEvent: (name, handler) => {
          return {
            dispose: this.root.uiEventDispatcher.add(
              name,
              context => {
                if (this.currentView === id) {
                  return handler(context);
                }
              },
              { path: this.path }
            ),
          };
        },
        bindHotkey: hotkeys => {
          return {
            dispose: this.root.uiEventDispatcher.bindHotkey(
              Object.fromEntries(
                Object.entries(hotkeys).map(([key, fn]) => [
                  key,
                  ctx => {
                    if (this.currentView === id) {
                      return fn(ctx);
                    }
                  },
                ])
              ),
              { path: this.path }
            ),
          };
        },
      };

      // init clipboard
      const clipboard = new {
        table: TableViewClipboard,
        kanban: KanbanViewClipboard,
      }[this.getViewDataById(id)?.mode ?? 'table'](this.root, {
        path: this.path,
        model: this.model,
        view: this._view,
        data: view,
      });
      clipboard.init();
    }
    return this.viewMap[id];
  }

  private renderViews = () => {
    return html` <data-view-header-views
      style="flex:1"
      .currentView="${this.currentView}"
      .setViewId="${this._setViewId}"
      .model="${this.model}"
    ></data-view-header-views>`;
  };
  private renderTitle = () => {
    const addRow = () => this._view.value?.addRow?.('start');
    return html` <affine-database-title
      .titleText="${this.model.title}"
      .readonly="${this.model.page.readonly}"
      .onPressEnterKey="${addRow}"
    ></affine-database-title>`;
  };
  private renderReference = () => {
    return html` <div></div>`;
  };

  private renderTools = (view?: DataViewManager) => {
    if (!view || !this._view.value) {
      return;
    }

    return html` <data-view-header-tools
      .viewEle="${this._view.value}"
      .view="${view}"
    ></data-view-header-tools>`;
  };

  private renderView(viewData?: ViewData) {
    if (!viewData) {
      return;
    }
    const props = {
      titleText: this.model.title,
      selectionUpdated: viewData.selectionUpdated,
      setSelection: viewData.setSelection,
      bindHotkey: viewData.bindHotkey,
      handleEvent: viewData.handleEvent,
      view: viewData.view,
      modalMode: this.modalMode,
      getFlag: this.page.awarenessStore.getFlag.bind(this.page.awarenessStore),
    };
    return keyed(
      viewData.view.id,
      renderUniLit(
        viewRendererManager.getView(viewData.view.type).view,
        props,
        { ref: this._view }
      )
    );
  }

  override render() {
    const viewData = this.model.views
      .map(view => this.getView(view.id))
      .find(v => v.view.id === this.currentView);
    if (!viewData && this.model.views.length !== 0) {
      this.currentView = this.model.views[0].id;
      return;
    }
    const containerClass = classMap({
      'toolbar-hover-container': true,
      'data-view-root': true,
      'database-block-selected': this.selected?.type === 'block',
    });
    return html`
      <div class="${containerClass}">
        <div
          style="margin-bottom: 16px;display:flex;flex-direction: column;gap: 8px"
        >
          <div style="display:flex;align-items:center;gap:12px;padding: 0 6px;">
            ${this.renderTitle()} ${this.renderReference()}
          </div>
          <div
            style="display:flex;align-items:center;justify-content: space-between;gap: 12px"
          >
            ${this.renderViews()} ${this.renderTools(viewData?.view)}
          </div>
        </div>
        ${this.renderView(viewData)}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-database': DatabaseBlockComponent;
  }
}
