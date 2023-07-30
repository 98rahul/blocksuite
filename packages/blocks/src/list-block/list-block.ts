/// <reference types="vite/client" />
import '../__internal__/rich-text/rich-text.js';

import { BlockElement } from '@blocksuite/lit';
import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';

import { BLOCK_CHILDREN_CONTAINER_PADDING_LEFT } from '../__internal__/consts.js';
import { bindContainerHotkey } from '../__internal__/rich-text/keymap/index.js';
import { attributeRenderer } from '../__internal__/rich-text/virgo/attribute-renderer.js';
import {
  affineTextAttributes,
  type AffineTextSchema,
} from '../__internal__/rich-text/virgo/types.js';
import { registerService } from '../__internal__/service/index.js';
import type { ListBlockModel } from './list-model.js';
import { ListBlockService } from './list-service.js';
import { styles } from './styles.js';
import { ListIcon } from './utils/get-list-icon.js';
import { getListInfo } from './utils/get-list-info.js';
import { toggleDown, toggleRight } from './utils/icons.js';

@customElement('affine-list')
export class ListBlockComponent extends BlockElement<ListBlockModel> {
  static override styles = styles;

  @state()
  showChildren = true;

  readonly textSchema: AffineTextSchema = {
    attributesSchema: affineTextAttributes,
    textRenderer: attributeRenderer,
  };

  private _select() {
    const selection = this.root.selectionManager;
    selection.update(selList => {
      return selList
        .filter(sel => !sel.is('text') && !sel.is('block'))
        .concat(selection.getInstance('block', { path: this.path }));
    });
  }

  private _onClickIcon = (e: MouseEvent) => {
    e.stopPropagation();

    if (this.model.type === 'toggle') {
      this.showChildren = !this.showChildren;
      return;
    } else if (this.model.type === 'todo') {
      this.model.page.captureSync();
      const checkedPropObj = { checked: !this.model.checked };
      this.model.page.updateBlock(this.model, checkedPropObj);
      return;
    }
    this._select();
  };

  override firstUpdated() {
    this.model.propsUpdated.on(() => this.requestUpdate());
    this.model.childrenUpdated.on(() => this.requestUpdate());
  }

  override connectedCallback() {
    super.connectedCallback();
    registerService('affine:list', ListBlockService);
    bindContainerHotkey(this);
  }

  override render() {
    const { deep, index } = getListInfo(this.model);
    const { model, showChildren, _onClickIcon } = this;
    const listIcon = ListIcon(model, index, deep, showChildren, _onClickIcon);

    const toggleChildren = () => (this.showChildren = !this.showChildren);
    const toggleIcon =
      this.model.children.length > 0
        ? this.showChildren
          ? html`<div class="toggle-icon" @click=${toggleChildren}>
              ${toggleDown()}
            </div>`
          : html`<div
              class="toggle-icon toggle-icon__collapsed"
              @click=${toggleChildren}
            >
              ${toggleRight()}
            </div>`
        : nothing;

    // For the first list item, we need to add a margin-top to make it align with the text
    const shouldAddMarginTop = index === 0 && deep === 0;
    const top = shouldAddMarginTop ? 'affine-list-block-container--first' : '';

    const children = html`<div
      class="affine-block-children-container"
      style="padding-left: ${BLOCK_CHILDREN_CONTAINER_PADDING_LEFT}px"
    >
      ${this.content}
    </div>`;

    return html`
      <div class=${`affine-list-block-container ${top}`}>
        <div class="affine-list-rich-text-wrapper">
          ${toggleIcon} ${listIcon}
          <rich-text
            .model=${this.model}
            .textSchema=${this.textSchema}
          ></rich-text>
          ${when(
            this.selected?.is('block'),
            () => html`<affine-block-selection></affine-block-selection>`
          )}
        </div>
        ${this.showChildren ? children : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-list': ListBlockComponent;
  }
}
