import '../../buttons/tool-icon-button.js';
import './frame-menu.js';

import { assertExists } from '@blocksuite/global/utils';
import { WithDisposable } from '@blocksuite/lit';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { EdgelessTool } from '../../../../../__internal__/index.js';
import { ArrowUpIcon, FrameIcon } from '../../../../../icons/index.js';
import { getTooltipWithShortcut } from '../../../components/utils.js';
import type { EdgelessPageBlockComponent } from '../../../edgeless-page-block.js';
import type { EdgelessFrameMenu } from './frame-menu.js';

interface FrameMenuPopper {
  element: EdgelessFrameMenu;
  dispose: () => void;
}

function createFrameMenuPopper(reference: HTMLElement): FrameMenuPopper {
  const frameMenu = document.createElement('edgeless-frame-menu');
  assertExists(reference.shadowRoot);
  reference.shadowRoot.appendChild(frameMenu);

  const x = 90;
  const y = -40;

  Object.assign(frameMenu.style, {
    left: `${x}px`,
    top: `${y}px`,
  });

  return {
    element: frameMenu,
    dispose: () => {
      frameMenu.remove();
    },
  };
}

@customElement('edgeless-frame-tool-button')
export class EdgelessFrameToolButton extends WithDisposable(LitElement) {
  static override styles = css`
    :host {
      display: flex;
    }

    edgeless-tool-icon-button svg + svg {
      position: absolute;
      top: 4px;
      right: 4px;
    }
  `;

  @property({ attribute: false })
  edgelessTool!: EdgelessTool;

  @property({ attribute: false })
  edgeless!: EdgelessPageBlockComponent;

  @property({ attribute: false })
  setEdgelessTool!: (edgelessTool: EdgelessTool) => void;

  private _frameMenu: FrameMenuPopper | null = null;

  private _toggleFrameMenu() {
    if (this._frameMenu) {
      this._frameMenu.dispose();
      this._frameMenu = null;
    } else {
      this._frameMenu = createFrameMenuPopper(this);
      this._frameMenu.element.edgelessTool = this.edgelessTool;
      this._frameMenu.element.edgeless = this.edgeless;
    }
  }

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('edgelessTool')) {
      if (this.edgelessTool.type !== 'frame') {
        this._frameMenu?.dispose();
        this._frameMenu = null;
      }
      if (this._frameMenu) {
        this._frameMenu.element.edgelessTool = this.edgelessTool;
        this._frameMenu.element.edgeless = this.edgeless;
      }
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    this._disposables.add(
      this.edgeless.slots.edgelessToolUpdated.on(newTool => {
        if (newTool.type !== 'frame') {
          this._frameMenu?.dispose();
          this._frameMenu = null;
        }
      })
    );
  }

  override disconnectedCallback() {
    this._frameMenu?.dispose();
    this._frameMenu = null;
    super.disconnectedCallback();
  }

  override render() {
    const type = this.edgelessTool?.type;

    return html`
      <edgeless-tool-icon-button
        .tooltip=${this._frameMenu ? '' : getTooltipWithShortcut('Frame', 'F')}
        .active=${type === 'frame'}
        .activeMode=${'background'}
        @click=${() => {
          this.setEdgelessTool({
            type: 'frame',
          });
          this._toggleFrameMenu();
        }}
      >
        ${FrameIcon} ${ArrowUpIcon}
      </edgeless-tool-icon-button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'edgeless-frame-tool-button': EdgelessFrameToolButton;
  }
}
