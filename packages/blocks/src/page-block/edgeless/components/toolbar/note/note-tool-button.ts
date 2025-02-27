import '../../buttons/tool-icon-button.js';
import './note-menu.js';

import { assertExists } from '@blocksuite/global/utils';
import { WithDisposable } from '@blocksuite/lit';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { EdgelessTool } from '../../../../../__internal__/index.js';
import type { CssVariableName } from '../../../../../__internal__/theme/css-variables.js';
import { ArrowUpIcon, NoteIcon } from '../../../../../icons/index.js';
import { getTooltipWithShortcut } from '../../../components/utils.js';
import type { EdgelessPageBlockComponent } from '../../../edgeless-page-block.js';
import type { EdgelessNoteMenu } from './note-menu.js';

export const NOTE_COLORS: CssVariableName[] = [
  '--affine-background-secondary-color',
  '--affine-tag-yellow',
  '--affine-tag-red',
  '--affine-tag-green',
  '--affine-tag-blue',
  '--affine-tag-purple',
];

export const DEFAULT_NOTE_COLOR = NOTE_COLORS[0];

interface NoteMenuPopper {
  element: EdgelessNoteMenu;
  dispose: () => void;
}

function createNoteMenuPopper(reference: HTMLElement): NoteMenuPopper {
  const noteMenu = document.createElement('edgeless-note-menu');
  assertExists(reference.shadowRoot);
  reference.shadowRoot.appendChild(noteMenu);

  const x = 90;
  const y = -40;

  Object.assign(noteMenu.style, {
    left: `${x}px`,
    top: `${y}px`,
  });

  return {
    element: noteMenu,
    dispose: () => {
      noteMenu.remove();
    },
  };
}

@customElement('edgeless-note-tool-button')
export class EdgelessNoteToolButton extends WithDisposable(LitElement) {
  static override styles = css`
    :host {
      display: flex;
    }

    edgeless-tool-icon-button svg + svg {
      margin-left: 8px;
    }
  `;

  @property({ attribute: false })
  edgelessTool!: EdgelessTool;

  @property({ attribute: false })
  edgeless!: EdgelessPageBlockComponent;

  @property({ attribute: false })
  setEdgelessTool!: (edgelessTool: EdgelessTool) => void;

  private _noteMenu: NoteMenuPopper | null = null;

  private _toggleNoteMenu() {
    if (this._noteMenu) {
      this._noteMenu.dispose();
      this._noteMenu = null;
    } else {
      this._noteMenu = createNoteMenuPopper(this);
      this._noteMenu.element.edgelessTool = this.edgelessTool;
      this._noteMenu.element.edgeless = this.edgeless;
    }
  }

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('edgelessTool')) {
      if (this.edgelessTool.type !== 'note') {
        this._noteMenu?.dispose();
        this._noteMenu = null;
      }
      if (this._noteMenu) {
        this._noteMenu.element.edgelessTool = this.edgelessTool;
        this._noteMenu.element.edgeless = this.edgeless;
      }
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    this._disposables.add(
      this.edgeless.slots.edgelessToolUpdated.on(newTool => {
        if (newTool.type !== 'note') {
          this._noteMenu?.dispose();
          this._noteMenu = null;
        }
      })
    );
  }

  override disconnectedCallback() {
    this._noteMenu?.dispose();
    this._noteMenu = null;
    super.disconnectedCallback();
  }

  override render() {
    const type = this.edgelessTool?.type;

    return html`
      <edgeless-tool-icon-button
        .tooltip=${this._noteMenu ? '' : getTooltipWithShortcut('Note', 'N')}
        .active=${type === 'note'}
        .activeMode=${'background'}
        @click=${() => {
          this.setEdgelessTool({
            type: 'note',
            background: DEFAULT_NOTE_COLOR,
            childFlavour: 'affine:paragraph',
            childType: 'text',
            tip: 'Text',
          });
          this._toggleNoteMenu();
        }}
      >
        ${NoteIcon} ${ArrowUpIcon}
      </edgeless-tool-icon-button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'edgeless-note-tool-button': EdgelessNoteToolButton;
  }
}
