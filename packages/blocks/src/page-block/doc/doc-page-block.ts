import './meta-data/meta-data.js';

import { type BlockService } from '@blocksuite/block-std';
import { assertExists } from '@blocksuite/global/utils';
import { Slot } from '@blocksuite/global/utils';
import { BlockElement } from '@blocksuite/lit';
import { VEditor } from '@blocksuite/virgo';
import { css, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { PageClipboard } from '../../__internal__/clipboard/index.js';
import {
  PAGE_BLOCK_CHILD_PADDING,
  PAGE_BLOCK_PADDING_BOTTOM,
} from '../../__internal__/consts.js';
import type { BlockHost, EditingState } from '../../__internal__/index.js';
import { asyncFocusRichText, matchFlavours } from '../../__internal__/index.js';
import { getService } from '../../__internal__/service/index.js';
import type { NoteBlockModel } from '../../note-block/index.js';
import type { DocPageBlockWidgetName } from '../index.js';
import { PageKeyboardManager } from '../keyborad/keyboard-manager.js';
import type { PageBlockModel } from '../page-model.js';
import { Gesture } from '../text-selection/gesture.js';

export interface PageViewport {
  left: number;
  top: number;
  scrollLeft: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  clientWidth: number;
}

@customElement('affine-doc-page')
export class DocPageBlockComponent
  extends BlockElement<PageBlockModel, BlockService, DocPageBlockWidgetName>
  implements BlockHost
{
  static override styles = css`
    .affine-doc-viewport {
      position: relative;
      overflow-x: hidden;
      overflow-y: auto;
      height: 100%;
    }

    .affine-doc-page-block-container {
      display: flex;
      flex-direction: column;
      width: 100%;
      font-family: var(--affine-font-family);
      font-size: var(--affine-font-base);
      line-height: var(--affine-line-height);
      color: var(--affine-text-primary-color);
      font-weight: 400;
      max-width: var(--affine-editor-width);
      margin: 0 auto;
      /* cursor: crosshair; */
      cursor: default;
      padding-bottom: ${PAGE_BLOCK_PADDING_BOTTOM}px;

      /* Leave a place for drag-handle */
      /* Do not use prettier format this style, or it will be broken */
      /* prettier-ignore */
      padding-left: var(--affine-editor-side-padding, ${PAGE_BLOCK_CHILD_PADDING}px);
      /* prettier-ignore */
      padding-right: var(--affine-editor-side-padding, ${PAGE_BLOCK_CHILD_PADDING}px);
    }

    .affine-doc-page-block-title {
      width: 100%;
      font-size: 40px;
      line-height: 50px;
      font-weight: 700;
      outline: none;
      resize: none;
      border: 0;
      font-family: inherit;
      color: inherit;
      cursor: text;
      padding: 38px 0;
    }

    .affine-doc-page-block-title-empty::before {
      content: 'Title';
      color: var(--affine-placeholder-color);
      position: absolute;
      opacity: 0.5;
    }

    .affine-doc-page-block-title:disabled {
      background-color: transparent;
    }

    /*
    .affine-doc-page-block-title-container {
    }
    */

    .affine-block-element {
      display: block;
    }

    @media print {
      .selected {
        background-color: transparent !important;
      }
    }
  `;

  keyboardManager: PageKeyboardManager | null = null;

  gesture: Gesture | null = null;

  clipboard = new PageClipboard(this);

  getService = getService;

  @state()
  private _isComposing = false;

  @query('.affine-doc-viewport')
  viewportElement!: HTMLDivElement;

  @query('.affine-doc-page-block-container')
  pageBlockContainer!: HTMLDivElement;

  slots = {
    draggingAreaUpdated: new Slot<DOMRect | null>(),
    selectedRectsUpdated: new Slot<DOMRect[]>(),
    embedRectsUpdated: new Slot<DOMRect[]>(),
    embedEditingStateUpdated: new Slot<EditingState | null>(),
    pageLinkClicked: new Slot<{
      pageId: string;
      blockId?: string;
    }>(),
    tagClicked: new Slot<{
      tagId: string;
    }>(),
  };

  @query('.affine-doc-page-block-title')
  private _titleContainer!: HTMLElement;
  private _titleVEditor: VEditor | null = null;

  get titleVEditor() {
    assertExists(this._titleVEditor);
    return this._titleVEditor;
  }

  get viewport(): PageViewport {
    if (!this.viewportElement) {
      return {
        left: 0,
        top: 0,
        scrollLeft: 0,
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        clientWidth: 0,
      };
    }

    const { clientHeight, clientWidth, scrollHeight, scrollLeft, scrollTop } =
      this.viewportElement;
    const { top, left } = this.viewportElement.getBoundingClientRect();
    return {
      top,
      left,
      clientHeight,
      clientWidth,
      scrollHeight,
      scrollLeft,
      scrollTop,
    };
  }

  private _initTitleVEditor() {
    const { model } = this;
    const title = model.title;

    this._titleVEditor = new VEditor(title.yText);
    this._titleVEditor.mount(this._titleContainer);
    this._titleVEditor.bindHandlers({
      keydown: this._onTitleKeyDown,
      paste: this._onTitlePaste,
    });
    this.addEventListener('copy', this._onTitleCopy);

    // Workaround for virgo skips composition event
    this._disposables.addFromEvent(
      this._titleContainer,
      'compositionstart',
      () => (this._isComposing = true)
    );
    this._disposables.addFromEvent(
      this._titleContainer,
      'compositionend',
      () => (this._isComposing = false)
    );

    this.model.title.yText.observe(() => {
      this._updateTitleInMeta();
      this.requestUpdate();
    });
    this._titleVEditor.setReadonly(this.page.readonly);
  }

  private _createDefaultNoteBlock() {
    const { page } = this;

    const noteId = page.addBlock('affine:note', {}, page.root?.id);
    return page.getBlockById(noteId);
  }

  private _getDefaultNoteBlock() {
    return (
      this.page.root?.children.find(child => child.flavour === 'affine:note') ??
      this._createDefaultNoteBlock()
    );
  }

  private _updateTitleInMeta = () => {
    this.page.workspace.setPageMeta(this.page.id, {
      title: this.model.title.toString(),
    });
  };

  private _onTitleKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing || this.page.readonly) return;
    const hasContent = !this.page.isEmpty;
    const { page, model } = this;

    if (e.key === 'Enter' && hasContent) {
      e.preventDefault();
      assertExists(this._titleVEditor);
      const vRange = this._titleVEditor.getVRange();
      assertExists(vRange);
      const right = model.title.split(vRange.index);
      const newFirstParagraphId = page.addBlock(
        'affine:paragraph',
        { text: right },
        this._getDefaultNoteBlock(),
        0
      );
      asyncFocusRichText(page, newFirstParagraphId);
      return;
    } else if (e.key === 'ArrowDown' && hasContent) {
      e.preventDefault();
      const defaultNote = this._getDefaultNoteBlock();
      const firstText = defaultNote?.children.find(block =>
        matchFlavours(block, ['affine:paragraph', 'affine:list', 'affine:code'])
      );
      if (firstText) {
        asyncFocusRichText(page, firstText.id);
      } else {
        const newFirstParagraphId = page.addBlock(
          'affine:paragraph',
          {},
          defaultNote,
          0
        );
        asyncFocusRichText(page, newFirstParagraphId);
      }
      return;
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  private _onTitleCopy = (event: ClipboardEvent) => {
    const vEditor = this._titleVEditor;
    if (!vEditor) return;
    const vRange = vEditor.getVRange();
    if (!vRange) return;

    const toBeCopiedText = vEditor.yText
      .toString()
      .substring(vRange.index, vRange.index + vRange.length);
    event.clipboardData?.setData('text/plain', toBeCopiedText);
  };

  private _onTitlePaste = (event: ClipboardEvent) => {
    const vEditor = this._titleVEditor;
    if (!vEditor) return;
    const vRange = vEditor.getVRange();
    if (!vRange) return;

    const data = event.clipboardData?.getData('text/plain');
    if (data) {
      const text = data.replace(/(\r\n|\r|\n)/g, '\n');
      vEditor.insertText(vRange, text);
      vEditor.setVRange({
        index: vRange.index + text.length,
        length: 0,
      });
    }
  };

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('model')) {
      if (this.model && !this._titleVEditor) {
        this._initTitleVEditor();
      }
    }
  }

  private _initSlotEffects() {
    this._disposables.add(
      this.model.childrenUpdated.on(() => this.requestUpdate())
    );
  }

  override firstUpdated() {
    this._initSlotEffects();
  }

  override connectedCallback() {
    super.connectedCallback();

    this.gesture = new Gesture(this);
    this.keyboardManager = new PageKeyboardManager(this);
    this.clipboard.init(this.page);
    // filter cut event in page title
    this.handleEvent('cut', ctx => {
      const { event } = ctx.get('defaultState');
      const element =
        event.target instanceof HTMLElement
          ? event.target
          : event.target instanceof Node
          ? event.target.parentElement
          : null;
      if (!element) {
        return;
      }

      if (element.closest('[data-block-is-title]')) {
        return true;
      }

      return;
    });

    this.bindHotKey({
      ArrowUp: () => {
        const view = this.root.viewStore;
        const selection = this.root.selectionManager;
        const sel = selection.value.find(
          sel => sel.is('text') || sel.is('block')
        );
        if (!sel) return;
        const focus = view.findPrev(sel.path, (nodeView, _index, parent) => {
          if (nodeView.type === 'block' && parent.view === this) {
            return true;
          }
          return;
        });
        if (!focus) return;
        const notes = this.childBlockElements.filter(
          el => el.model.flavour === 'affine:note'
        );
        const index = notes.indexOf(focus.view as BlockElement);
        if (index !== 0) {
          const prev = notes[index - 1];
          const lastNoteChild = sel.is('text')
            ? prev.childBlockElements.reverse().find(el => !!el.model.text)
            : prev.childBlockElements.at(-1);
          if (!lastNoteChild) return;
          selection.update(selList =>
            selList
              .filter(sel => !sel.is('text') && !sel.is('block'))
              .concat([
                sel.is('text')
                  ? selection.getInstance('text', {
                      from: {
                        path: lastNoteChild.path,
                        index: lastNoteChild.model.text?.length ?? 0,
                        length: 0,
                      },
                      to: null,
                    })
                  : selection.getInstance('block', {
                      path: lastNoteChild.path,
                    }),
              ])
          );
          return true;
        }

        selection.update(selList =>
          selList
            .filter(sel => !sel.is('text') && !sel.is('block'))
            .concat([
              selection.getInstance('text', {
                from: {
                  path: this.path,
                  index: this.model.title.length,
                  length: 0,
                },
                to: null,
              }),
            ])
        );
        return true;
      },
      ArrowDown: () => {
        const view = this.root.viewStore;
        const selection = this.root.selectionManager;
        const sel = selection.value.find(
          sel => sel.is('text') || sel.is('block')
        );
        if (!sel) return;
        const focus = view.findPrev(sel.path, (nodeView, _index, parent) => {
          if (nodeView.type === 'block' && parent.view === this) {
            return true;
          }
          return;
        });
        if (!focus) return;
        const notes = this.childBlockElements.filter(
          el => el.model.flavour === 'affine:note'
        );
        const index = notes.indexOf(focus.view as BlockElement);
        if (index < notes.length - 1) {
          const prev = notes[index + 1];
          const firstNoteChild = sel.is('text')
            ? prev.childBlockElements.find(x => !!x.model.text)
            : prev.childBlockElements.at(0);
          if (!firstNoteChild) return;
          selection.update(selList =>
            selList
              .filter(sel => !sel.is('text') && !sel.is('block'))
              .concat([
                sel.is('text')
                  ? selection.getInstance('text', {
                      from: {
                        path: firstNoteChild.path,
                        index: 0,
                        length: 0,
                      },
                      to: null,
                    })
                  : selection.getInstance('block', {
                      path: firstNoteChild.path,
                    }),
              ])
          );
          return true;
        }
        return;
      },
    });

    this.handleEvent('click', ctx => {
      const state = ctx.get('pointerState');
      if (
        state.raw.target !== this &&
        state.raw.target !== this.viewportElement &&
        state.raw.target !== this.pageBlockContainer
      ) {
        return;
      }
      let noteId: string;
      let paragraphId: string;
      let index = 0;
      const lastNote = this.model.children
        .slice()
        .reverse()
        .find(
          child =>
            child.flavour === 'affine:note' && !(child as NoteBlockModel).hidden
        );
      if (!lastNote) {
        noteId = this.page.addBlock('affine:note', {}, this.model.id);
        paragraphId = this.page.addBlock('affine:paragraph', {}, noteId);
      } else {
        noteId = lastNote.id;
        const last = lastNote.children.at(-1);
        if (!last || !last.text) {
          paragraphId = this.page.addBlock('affine:paragraph', {}, noteId);
        } else {
          paragraphId = last.id;
          index = last.text.length ?? 0;
        }
      }

      requestAnimationFrame(() => {
        this.root.selectionManager.setGroup('note', [
          this.root.selectionManager.getInstance('text', {
            from: {
              path: [this.model.id, noteId, paragraphId],
              index,
              length: 0,
            },
            to: null,
          }),
        ]);
      });
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.clipboard.dispose();
    this._disposables.dispose();
    this.gesture = null;
    this.keyboardManager = null;
  }

  override render() {
    const isEmpty =
      (!this.model.title || !this.model.title.length) && !this._isComposing;
    const title = html`
      <div
        data-block-is-title="true"
        class="affine-doc-page-block-title ${isEmpty
          ? 'affine-doc-page-block-title-empty'
          : ''}"
      ></div>
    `;

    const content = html`${repeat(
      this.model.children.filter(
        child => !(matchFlavours(child, ['affine:note']) && child.hidden)
      ),
      child => child.id,
      child => this.renderModel(child)
    )}`;

    const widgets = html`${repeat(
      Object.entries(this.widgets),
      ([id]) => id,
      ([_, widget]) => widget
    )}`;

    const meta = html`
      <affine-page-meta-data
        .pageElement="${this}"
        .page="${this.page}"
      ></affine-page-meta-data>
    `;

    return html`
      <div class="affine-doc-viewport">
        <div class="affine-doc-page-block-container">
          <div class="affine-doc-page-block-title-container">
            ${title} ${meta}
          </div>
          ${content} ${widgets}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-doc-page': DocPageBlockComponent;
  }
}
