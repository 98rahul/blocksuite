/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@shoelace-style/shoelace';

import { ShadowlessElement } from '@blocksuite/lit';
import {
  type AttributeRenderer,
  type BaseTextAttributes,
  baseTextAttributes,
  createKeyDownHandler,
  type DeltaInsert,
  VEditor,
  ZERO_WIDTH_NON_JOINER,
} from '@blocksuite/virgo';
import { css, html, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import * as Y from 'yjs';
import { z } from 'zod';

import { markdownMatches } from './markdown.js';

function virgoTextStyles(
  props: BaseTextAttributes
): ReturnType<typeof styleMap> {
  let textDecorations = '';
  if (props.underline) {
    textDecorations += 'underline';
  }
  if (props.strike) {
    textDecorations += ' line-through';
  }

  let inlineCodeStyle = {};
  if (props.code) {
    inlineCodeStyle = {
      'font-family':
        '"SFMono-Regular", Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace',
      'line-height': 'normal',
      background: 'rgba(135,131,120,0.15)',
      color: '#EB5757',
      'border-radius': '3px',
      'font-size': '85%',
      padding: '0.2em 0.4em',
    };
  }

  return styleMap({
    'word-wrap': 'break-word',
    'white-space': 'break-spaces',
    'font-weight': props.bold ? 'bold' : 'normal',
    'font-style': props.italic ? 'italic' : 'normal',
    'text-decoration': textDecorations.length > 0 ? textDecorations : 'none',
    ...inlineCodeStyle,
  });
}

const attributeRenderer: AttributeRenderer = (
  delta: DeltaInsert,
  selected: boolean
) => {
  // @ts-ignore
  if (delta.attributes?.embed) {
    return html`<span
      style=${styleMap({
        padding: '0 0.4em',
        border: selected ? '1px solid #eb763a' : '',
        background: 'rgba(135,131,120,0.15)',
      })}
      >@flrande<v-text .str=${ZERO_WIDTH_NON_JOINER}></v-text
    ></span>`;
  }

  const style = delta.attributes
    ? virgoTextStyles(delta.attributes)
    : styleMap({
        'white-space': 'break-spaces',
        'word-wrap': 'break-word',
      });

  return html`<span style=${style}
    ><v-text .str=${delta.insert}></v-text
  ></span>`;
};

function toggleStyle(
  vEditor: VEditor,
  attrs: NonNullable<BaseTextAttributes>
): void {
  const vRange = vEditor.getVRange();
  if (!vRange) {
    return;
  }

  const root = vEditor.rootElement;
  if (!root) {
    return;
  }

  const deltas = vEditor.getDeltasByVRange(vRange);
  let oldAttributes: NonNullable<BaseTextAttributes> = {};

  for (const [delta] of deltas) {
    const attributes = delta.attributes;

    if (!attributes) {
      continue;
    }

    oldAttributes = { ...attributes };
  }

  const newAttributes = Object.fromEntries(
    Object.entries(attrs).map(([k, v]) => {
      if (
        typeof v === 'boolean' &&
        v === (oldAttributes as { [k: string]: unknown })[k]
      ) {
        return [k, null];
      } else {
        return [k, v];
      }
    })
  );

  vEditor.formatText(vRange, newAttributes, {
    mode: 'merge',
  });
  root.blur();

  vEditor.setVRange(vRange);
}

@customElement('virgo-test-rich-text')
export class RichText extends ShadowlessElement {
  @query('.rich-text-container')
  private _container!: HTMLDivElement;

  @property({ attribute: false })
  vEditor!: VEditor;

  @property({ attribute: false })
  undoManager!: Y.UndoManager;

  override firstUpdated() {
    this.vEditor.mount(this._container);

    const keydownHandler = createKeyDownHandler(this.vEditor, {
      inputRule: {
        key: ' ',
        handler: context => {
          const { vEditor, prefixText, vRange } = context;
          for (const match of markdownMatches) {
            const matchedText = prefixText.match(match.pattern);
            if (matchedText) {
              return match.action({
                vEditor,
                prefixText,
                vRange,
                pattern: match.pattern,
                undoManager: this.undoManager,
              });
            }
          }

          return false;
        },
      },
    });
    this._container.addEventListener('keydown', keydownHandler);

    this.vEditor.slots.updated.on(() => {
      const el = this.querySelector('.y-text');
      if (el) {
        const text = this.vEditor.yText.toDelta();
        const span = document.createElement('span');
        span.innerHTML = JSON.stringify(text);
        el.replaceChildren(span);
      }
    });
    this.vEditor.slots.vRangeUpdated.on(() => {
      const el = this.querySelector('.v-range');
      if (el) {
        const vRange = this.vEditor.getVRange();
        if (vRange) {
          const span = document.createElement('span');
          span.innerHTML = JSON.stringify(vRange);
          el.replaceChildren(span);
        }
      }
    });
  }

  override render() {
    return html`<style>
        virgo-test-rich-text {
          display: grid;
          grid-template-rows: minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr);
          grid-template-columns: minmax(0, 1fr);
          width: 100%;
        }

        .rich-text-container {
          outline: none;
          word-break: break-word;
          white-space: break-spaces;
        }

        code {
          font-family: 'SFMono-Regular', Menlo, Consolas, 'PT Mono',
            'Liberation Mono', Courier, monospace;
          line-height: normal;
          background: rgba(135, 131, 120, 0.15);
          color: #eb5757;
          border-radius: 3px;
          font-size: 85%;
          padding: 0.2em 0.4em;
        }

        .v-range,
        .y-text {
          font-family: 'SFMono-Regular', Menlo, Consolas, 'PT Mono',
            'Liberation Mono', Courier, monospace;
          line-height: normal;
          background: rgba(135, 131, 120, 0.15);
        }

        .v-range,
        .y-text > span {
          display: block;
          word-wrap: break-word;
        }
      </style>
      <div class="rich-text-container"></div>
      <div class="v-range"></div>
      <div class="y-text"></div>`;
  }
}

const TEXT_ID = 'virgo';
const yDocA = new Y.Doc();
const yDocB = new Y.Doc();

yDocA.on('update', update => {
  Y.applyUpdate(yDocB, update);
});

yDocB.on('update', update => {
  Y.applyUpdate(yDocA, update);
});

@customElement('tool-bar')
export class ToolBar extends ShadowlessElement {
  static override styles = css`
    .tool-bar {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(0, 1fr));
    }
  `;

  @property({ attribute: false })
  vEditor!: VEditor;

  @property({ attribute: false })
  undoManager!: Y.UndoManager;

  override firstUpdated() {
    const boldButton = this.querySelector('.bold');
    const italicButton = this.querySelector('.italic');
    const underlineButton = this.querySelector('.underline');
    const strikeButton = this.querySelector('.strike');
    const code = this.querySelector('.code');
    const embed = this.querySelector('.embed');
    const resetButton = this.querySelector('.reset');
    const undoButton = this.querySelector('.undo');
    const redoButton = this.querySelector('.redo');

    if (
      !boldButton ||
      !italicButton ||
      !underlineButton ||
      !strikeButton ||
      !code ||
      !embed ||
      !resetButton ||
      !undoButton ||
      !redoButton
    ) {
      throw new Error('Cannot find button');
    }

    const undoManager = new Y.UndoManager(this.vEditor.yText, {
      trackedOrigins: new Set([this.vEditor.yText.doc?.clientID]),
    });

    addEventListener('keydown', e => {
      if (
        e instanceof KeyboardEvent &&
        (e.ctrlKey || e.metaKey) &&
        e.key === 'z'
      ) {
        e.preventDefault();
        if (e.shiftKey) {
          undoManager.redo();
        } else {
          undoManager.undo();
        }
      }
    });

    undoButton.addEventListener('click', () => {
      undoManager.undo();
    });
    redoButton.addEventListener('click', () => {
      undoManager.redo();
    });

    boldButton.addEventListener('click', () => {
      undoManager.stopCapturing();
      toggleStyle(this.vEditor, { bold: true });
    });
    italicButton.addEventListener('click', () => {
      undoManager.stopCapturing();
      toggleStyle(this.vEditor, { italic: true });
    });
    underlineButton.addEventListener('click', () => {
      undoManager.stopCapturing();
      toggleStyle(this.vEditor, { underline: true });
    });
    strikeButton.addEventListener('click', () => {
      undoManager.stopCapturing();
      toggleStyle(this.vEditor, { strike: true });
    });
    code.addEventListener('click', () => {
      undoManager.stopCapturing();
      toggleStyle(this.vEditor, { code: true });
    });
    embed.addEventListener('click', () => {
      undoManager.stopCapturing();
      //@ts-ignore
      toggleStyle(this.vEditor, { embed: true });
    });
    resetButton.addEventListener('click', () => {
      undoManager.stopCapturing();
      const rangeStatic = this.vEditor.getVRange();
      if (!rangeStatic) {
        return;
      }
      this.vEditor.resetText(rangeStatic);
    });
  }

  override render() {
    return html`
      <div class="tool-bar">
        <sl-button class="bold">bold</sl-button>
        <sl-button class="italic">italic</sl-button>
        <sl-button class="underline">underline</sl-button>
        <sl-button class="strike">strike</sl-button>
        <sl-button class="code">code</sl-button>
        <sl-button class="embed">embed</sl-button>
        <sl-button class="reset">reset</sl-button>
        <sl-button class="undo">undo</sl-button>
        <sl-button class="redo">redo</sl-button>
      </div>
    `;
  }
}

@customElement('test-page')
export class TestPage extends ShadowlessElement {
  static override styles = css`
    .container {
      display: grid;
      height: 100vh;
      width: 100vw;
      justify-content: center;
      align-items: center;
    }

    .editors {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      padding: 20px;
      background-color: #202124;
      border-radius: 10px;
      color: #fff;
      grid-gap: 20px;
    }

    .editors > div {
      height: 600px;
      max-width: 400px;
      display: grid;
      grid-template-rows: 150px minmax(0, 1fr);
      grid-template-columns: minmax(0, 1fr);
      overflow-y: scroll;
    }
  `;

  private _editorA: VEditor | null = null;
  private _editorB: VEditor | null = null;
  private _undoManagerA: Y.UndoManager | null = null;
  private _undoManagerB: Y.UndoManager | null = null;

  override firstUpdated() {
    const textA = yDocA.getText(TEXT_ID);
    this._editorA = new VEditor<
      BaseTextAttributes & {
        embed?: true;
      }
    >(textA, {
      isEmbed: delta => !!delta.attributes?.embed,
    });
    this._editorA.setAttributeSchema(
      baseTextAttributes.extend({
        embed: z.literal(true).optional().catch(undefined),
      })
    );
    this._editorA.setAttributeRenderer(attributeRenderer);
    this._undoManagerA = new Y.UndoManager(textA, {
      trackedOrigins: new Set([textA.doc?.clientID]),
    });

    const textB = yDocB.getText(TEXT_ID);
    this._editorB = new VEditor(textB);
    this._undoManagerB = new Y.UndoManager(textB, {
      trackedOrigins: new Set([textB.doc?.clientID]),
    });

    this.requestUpdate();
  }

  override render() {
    if (!this._editorA) {
      return nothing;
    }

    return html`
      <div class="container">
        <div class="editors">
          <div class="doc-a">
            <tool-bar
              .vEditor=${this._editorA}
              .undoManager=${this._undoManagerA}
            ></tool-bar>
            <virgo-test-rich-text
              .vEditor=${this._editorA}
              .undoManager=${this._undoManagerA!}
            ></virgo-test-rich-text>
          </div>
          <div class="doc-b">
            <tool-bar
              .vEditor=${this._editorB}
              .undoManager=${this._undoManagerB!}
            ></tool-bar>
            <virgo-test-rich-text
              .vEditor=${this._editorB}
              .undoManager=${this._undoManagerB}
            ></virgo-test-rich-text>
          </div>
        </div>
      </div>
    `;
  }
}
