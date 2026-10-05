/**
 * The parts the page draws, built on the kit the platform loads into every
 * view: its `hs-*` classes, which give each part the look of the same part
 * in the shell, and the Remix Icon font with its `ri-*` classes.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';

/** A Remix Icon by its remixicon.com name, at a size in pixels, in the
 *  colour of the text around it. */
export function Icon({
  name,
  size,
  className,
}: {
  name: string;
  size: number;
  className?: string;
}) {
  return (
    <i
      aria-hidden="true"
      className={`ri-${name} schedules-icon${className ? ` ${className}` : ''}`}
      style={{ fontSize: size }}
    />
  );
}

/** A text button: `secondary` is the glass control, `danger` a
 *  destructive action in the error colour. */
export function Button({
  children,
  variant = 'secondary',
  icon,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  variant?: 'secondary' | 'danger';
  icon?: ReactNode;
}) {
  return (
    <button
      {...rest}
      type="button"
      data-variant={variant}
      data-size="sm"
      className={className ? `hs-button ${className}` : 'hs-button'}
    >
      {icon}
      {children}
    </button>
  );
}

/** A small square control that shows a mark alone and carries its name. */
export function IconButton({
  children,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & { 'aria-label': string }) {
  return (
    <button
      {...rest}
      type="button"
      data-size="sm"
      className={className ? `hs-icon-button ${className}` : 'hs-icon-button'}
    >
      {children}
    </button>
  );
}

/** One choice of a row of chips, on a plate while it is the chosen one. */
export function Chip({
  children,
  selected,
  onClick,
}: {
  children: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="hs-chip"
      data-sel={selected ? 'true' : 'false'}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="hs-chip-text">{children}</span>
    </button>
  );
}

/** A condition stated inline, such as a refusal. */
export function Notice({ children }: { children: ReactNode }) {
  return <div className="hs-notice">{children}</div>;
}

/** A state in one or two words, coloured by its tone. */
export function StatusWord({ tone, children }: { tone: 'bad'; children: ReactNode }) {
  return (
    <span className="hs-status" data-tone={tone}>
      {children}
    </span>
  );
}

/** A one-line text field with a box. */
export function TextInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>,
) {
  return <input {...props} type="text" className="hs-input" data-variant="text" />;
}

/** A page's opening heading and its one line under it. */
export function PageTitle({ children, lead }: { children: ReactNode; lead: ReactNode }) {
  return (
    <>
      <h1 className="hs-page-title">{children}</h1>
      <p className="hs-page-lead">{lead}</p>
    </>
  );
}

/** One group of rows inside a single border. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="hs-settings-card">{children}</div>;
}

/** A muted heading above a card. */
export function SettingsSection({ children }: { children: ReactNode }) {
  return (
    <div className="hs-settings-section" data-first="false">
      <span>{children}</span>
    </div>
  );
}

/** The search field whose placeholder sits centred and slides left on
 *  focus. */
export function SettingsSearch({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="hs-url hs-settings-search">
      <Icon name="search-line" size={12} />
      <input
        className="hs-in hs-urlin"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span aria-hidden="true" className="hs-urlph hs-ph-icon">
        {placeholder}
      </span>
    </label>
  );
}

/** A labelled row with a value at its end. */
export function InfoRow({
  title,
  sub,
  value,
}: {
  title: ReactNode;
  sub?: string;
  value: ReactNode;
}) {
  return (
    <div className="hs-setrow hs-info-row">
      <span className="hs-setting-label">
        <span className="hs-setting-label-line">
          <span className="hs-setting-title">{title}</span>
        </span>
        {sub && <span className="hs-setting-sub">{sub}</span>}
      </span>
      <span className="hs-setting-value">{value}</span>
    </div>
  );
}

/** A row whose whole face opens what it names, with a chevron at its end. */
export function LinkRow({
  mark,
  title,
  sub,
  onOpen,
}: {
  mark?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="hs-setrow hs-link-row" onClick={onOpen}>
      {mark && <span className="hs-row-mark">{mark}</span>}
      <span className="hs-setting-label">
        <span className="hs-setting-title">{title}</span>
        {sub && <span className="hs-setting-sub">{sub}</span>}
      </span>
      <Icon name="arrow-right-s-line" size={13} className="hs-link-row-chevron" />
    </button>
  );
}

/** A row of a list: a mark, a title with a line under it, and its actions. */
export function ListRow({
  mark,
  title,
  sub,
  actions,
}: {
  mark?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="hs-setrow hs-list-row">
      {mark && <span className="hs-row-mark">{mark}</span>}
      <span className="hs-setting-label">
        <span className="hs-setting-title">{title}</span>
        {sub && <span className="hs-setting-sub">{sub}</span>}
      </span>
      {actions && <span className="hs-list-row-actions">{actions}</span>}
    </div>
  );
}

/** A dialog that asks once more before an action that destroys
 *  something; Escape and a press outside it cancel. */
export function ShellConfirm({
  title,
  body,
  action,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return (
    <div
      className="hs-confirm"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div className="hs-confirm-box" role="dialog" onClick={(e) => e.stopPropagation()}>
        <span className="hs-confirm-title">{title}</span>
        <span className="hs-confirm-body">{body}</span>
        <div className="hs-confirm-footer">
          <Button className="hs-confirm-cancel" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="hs-confirm-action" variant="danger" onClick={onConfirm}>
            {action}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The element a menu opens from, which it stays beside. */
export interface MenuAnchor {
  element: HTMLElement;
}

export const anchorFrom = (e: ReactMouseEvent<HTMLElement>): MenuAnchor => ({
  element: e.currentTarget,
});

/** A menu on the frosted popup surface, beside its anchor and inside the
 *  page. It holds the keyboard: the arrows move through its rows, Escape
 *  and Tab close it, and so do a press outside it and the focus leaving
 *  the page. A long list scrolls, opened on its selected row. */
export function MenuSurface({
  anchor,
  align = 'auto',
  minWidth = 180,
  maxHeight,
  onDismiss,
  children,
}: {
  anchor: MenuAnchor;
  align?: 'auto' | 'right';
  minWidth?: number;
  maxHeight?: number;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (focused.current || pos.visibility !== 'visible') return;
    const choices = menu.current?.querySelectorAll<HTMLElement>(
      '[role^="menuitem"]:not([aria-disabled="true"])',
    );
    const selected = menu.current?.querySelector<HTMLElement>(
      '[aria-checked="true"]:not([aria-disabled="true"])',
    );
    (selected ?? choices?.[0])?.focus();
    focused.current = true;
  }, [pos.visibility]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !anchor.element.contains(event.target)
      )
        onDismiss();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', onDismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', onDismiss);
    };
  }, [anchor.element, onDismiss]);
  useLayoutEffect(() => {
    if (pos.visibility !== 'visible') return;
    const surface = menu.current?.firstElementChild as HTMLElement | undefined;
    const row = surface?.querySelector<HTMLElement>('[data-sel="true"]');
    if (!surface || !row) return;
    surface.scrollTop = row.offsetTop - (surface.clientHeight - row.offsetHeight) / 2;
  }, [pos.visibility]);
  useLayoutEffect(() => {
    const floating = menu.current!;
    let live = true;
    const update = () => {
      const rect = anchor.element.getBoundingClientRect();
      const edge =
        align === 'auto'
          ? (rect.left + rect.right) / 2 > window.innerWidth / 2
            ? 'right'
            : 'left'
          : align;
      void computePosition(anchor.element, floating, {
        placement: edge === 'right' ? 'bottom-end' : 'bottom-start',
        middleware: [
          offset(6),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableWidth, availableHeight, elements, rects }) {
              const surface = elements.floating.firstElementChild as HTMLElement;
              const wanted = Math.max(minWidth, rects.reference.width);
              surface.style.minWidth = `${Math.max(0, Math.min(wanted, availableWidth))}px`;
              surface.style.maxWidth = `${Math.max(0, availableWidth)}px`;
              surface.style.maxHeight = `${Math.max(0, Math.min(maxHeight ?? Infinity, availableHeight))}px`;
            },
          }),
        ],
      }).then(({ x, y }) => {
        if (live) setPos({ left: x, top: y, visibility: 'visible' });
      });
    };
    const cleanup = autoUpdate(anchor.element, floating, update);
    return () => {
      live = false;
      cleanup();
    };
  }, [anchor.element, align, minWidth, maxHeight]);
  useEffect(() => {
    const floating = menu.current!;
    const wheel = (e: WheelEvent) => {
      const surface = floating.firstElementChild as HTMLElement;
      if (surface.scrollHeight <= surface.clientHeight) e.preventDefault();
    };
    floating.addEventListener('wheel', wheel, { passive: false });
    return () => floating.removeEventListener('wheel', wheel);
  }, []);
  return createPortal(
    <div
      ref={menu}
      className="hs-menu-position"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
          }
          anchor.element.focus();
          onDismiss();
          return;
        }
        const choices = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            '[role^="menuitem"]:not([aria-disabled="true"])',
          ),
        ];
        const current = choices.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === 'ArrowDown'
            ? (current + 1) % choices.length
            : event.key === 'ArrowUp'
              ? (current + choices.length - 1) % choices.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? choices.length - 1
                  : null;
        if (next !== null) {
          event.stopPropagation();
          event.preventDefault();
          choices[next]?.focus();
        }
      }}
      style={pos}
    >
      <div
        className="hs-menu hs-menu-surface"
        role="menu"
        data-closing="false"
        style={{ minWidth: `min(${minWidth}px, calc(100vw - 16px))` }}
      >
        {children}
      </div>
    </div>,
    document.documentElement,
  );
}

/** One row of a menu: a mark, a label with an optional line under it, and
 *  a check on the chosen one. A disabled row stays readable and inert. */
export function MItem({
  icon,
  label,
  sub,
  checked,
  danger,
  disabled,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  sub?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      className={`hs-mitem hs-menu-item-row ${
        danger ? 'hs-inkbad hs-hovbox' : disabled ? 'hs-inkdim' : 'hs-inkmut hs-hovbox-ink'
      }`}
      data-sel={checked ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {icon}
      <span className="hs-menu-label">
        <span className="hs-menu-title">{label}</span>
        {sub && <span className="hs-menu-sub">{sub}</span>}
      </span>
      {checked && <Icon name="check-fill" size={13} />}
    </div>
  );
}

/** A hairline between the groups of a menu. */
export function MDivider() {
  return <div className="hs-menu-divider" />;
}

/** A picker on the menu, in place of a native select. A disabled entry
 *  stays visible, so the reason it cannot be picked reads where the pick
 *  is made. */
export function SettingsSelect<T extends string>({
  value,
  options,
  onPick,
  minWidth = 180,
  menuHeight,
  placeholder,
}: {
  value: T;
  options: { value: T; label: string; sub?: string; disabled?: boolean }[];
  onPick: (value: T) => void;
  minWidth?: number;
  menuHeight?: number;
  placeholder?: string;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const current = options.find((o) => o.value === value);
  return (
    <span className="hs-select-wrap">
      <button
        type="button"
        className="hs-glassbtn hs-hovink hs-inktext hs-select"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-open={anchor ? 'true' : 'false'}
        onClick={(e) => {
          const next = anchorFrom(e);
          setAnchor((held) => (held ? null : next));
        }}
      >
        {current?.label ?? (value || placeholder)}
        <Icon name="arrow-down-s-line" size={11} />
      </button>
      {anchor && (
        <MenuSurface
          anchor={anchor}
          onDismiss={() => setAnchor(null)}
          minWidth={minWidth}
          {...(menuHeight !== undefined && { maxHeight: menuHeight })}
        >
          {options.map((option) => (
            <MItem
              key={option.value}
              label={option.label}
              {...(option.sub && { sub: option.sub })}
              {...(option.disabled && { disabled: true })}
              checked={option.value === value}
              onClick={() => {
                anchor.element.focus();
                setAnchor(null);
                onPick(option.value);
              }}
            />
          ))}
        </MenuSurface>
      )}
    </span>
  );
}

/** An app's icon from a picture, or the app mark where there is none. */
export function AppIcon({ src, size }: { src: string | null; size: number }) {
  return (
    <span className="hs-app-icon" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" /> : <Icon name="box-3-fill" size={size} />}
    </span>
  );
}
