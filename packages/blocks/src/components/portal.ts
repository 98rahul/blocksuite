import { assertExists } from '@blocksuite/global/utils';
import {
  autoUpdate,
  type AutoUpdateOptions,
  computePosition,
  type ComputePositionConfig,
  type VirtualElement,
} from '@floating-ui/dom';
import { render, type RenderOptions, type TemplateResult } from 'lit';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Renders a template into a portal. Defaults to `document.body`.
 *
 * Note that every time the parent component re-renders, the portal will be re-called.
 *
 * See https://lit.dev/docs/components/rendering/#writing-a-good-render()-method
 *
 * @example
 * ```ts
 * render() {
 *   return html`${showPortal
 *     ? html`<blocksuite-portal .template=${portalTemplate}></blocksuite-portal>`
 *     : null}`;
 * };
 * ```
 */
@customElement('blocksuite-portal')
export class Portal extends LitElement {
  @property({ attribute: false })
  public container = document.body;

  @property({ attribute: false })
  public template = html``;

  private _portalRoot: HTMLElement | null = null;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._portalRoot?.remove();
  }

  override createRenderRoot() {
    const portalRoot = document.createElement('div');
    portalRoot.classList.add('blocksuite-portal');
    this.container.append(portalRoot);
    this._portalRoot = portalRoot;
    return portalRoot;
  }

  override render() {
    return this.template;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'blocksuite-portal': Portal;
  }
}

type PortalOptions = {
  template: TemplateResult<1>;
  container?: HTMLElement;
  abortController?: AbortController;
  shadowDom?: boolean;
  renderOptions?: RenderOptions;
  /**
   * Defaults to `true`.
   * If true, the portalRoot will be added a class `blocksuite-portal`. It's useful for finding the portalRoot.
   */
  identifyWrapper?: boolean;
};
/**
 * Similar to `<blocksuite-portal>`, but only renders once when called.
 *
 * The template should be a **static** template since it will not be re-rendered.
 *
 * See {@link Portal} for more details.
 */
export function createSimplePortal({
  template,
  container = document.body,
  abortController = new AbortController(),
  renderOptions,
  shadowDom = true,
  identifyWrapper = true,
}: PortalOptions) {
  const portalRoot = document.createElement('div');
  if (identifyWrapper) {
    portalRoot.classList.add('blocksuite-portal');
  }
  if (shadowDom) {
    portalRoot.attachShadow({ mode: 'open' });
  }
  abortController.signal.addEventListener('abort', () => {
    portalRoot.remove();
  });

  const root = shadowDom ? portalRoot.shadowRoot : portalRoot;
  assertExists(root);
  render(template, root, renderOptions);
  container.append(portalRoot);
  return portalRoot;
}

/**
 * Similar to `createSimplePortal`, but supports auto update position.
 *
 * The template should be a **static** template since it will not be re-rendered.
 *
 * See {@link createSimplePortal} for more details.
 *
 * @example
 * ```ts
 * createLitPortal({
 *   template: RenameModal({
 *     model,
 *     abortController: renameAbortController,
 *   }),
 *   computePosition: {
 *     referenceElement: anchor,
 *     placement: 'top-end',
 *     middleware: [flip(), offset(4)],
 *     autoUpdate: true,
 *   },
 *   abortController: renameAbortController,
 * });
 * ```
 */
export function createLitPortal({
  computePosition: computePositionOptions,
  ...portalOptions
}: PortalOptions & {
  /**
   * See https://floating-ui.com/docs/computePosition
   */
  computePosition?: {
    referenceElement: VirtualElement;
    /**
     * Default `false`.
     */
    autoUpdate?: true | AutoUpdateOptions;
  } & Partial<ComputePositionConfig>;
}) {
  const portalRoot = createSimplePortal(portalOptions);

  if (computePositionOptions) {
    portalRoot.style.position = 'fixed';
    portalRoot.style.left = '0';
    portalRoot.style.top = '0';
    const { referenceElement, ...options } = computePositionOptions;
    const maybeAutoUpdateOptions = computePositionOptions.autoUpdate ?? {};
    const update = () =>
      computePosition(referenceElement, portalRoot, options).then(
        ({ x, y }) => {
          // Use transform maybe cause overlay-mask offset issue
          // portalRoot.style.transform = `translate(${x}px, ${y}px)`;
          portalRoot.style.left = `${x}px`;
          portalRoot.style.top = `${y}px`;
        }
      );
    if (!maybeAutoUpdateOptions) {
      update();
    } else {
      const autoUpdateOptions =
        maybeAutoUpdateOptions === true ? {} : maybeAutoUpdateOptions;
      autoUpdate(referenceElement, portalRoot, update, autoUpdateOptions);
    }
  }

  return portalRoot;
}
