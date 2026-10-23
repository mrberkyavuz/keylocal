import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string; icon?: ReactNode };

/** Select-only combobox. The popup escapes scroll containers without moving focus. */
export function Select({
  label,
  value,
  options,
  onChange,
  compact = false,
  icon,
  className = "",
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  compact?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 220,
    maxHeight: 280,
  });
  const selected = options.findIndex((o) => o.value === value);
  const current = options[selected];
  const typeahead = useRef({ text: "", time: 0 });
  const show = () => {
    setActive(Math.max(0, selected));
    setOpen(true);
  };
  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
      const desired = Math.min(options.length * 38 + 12, 290);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < desired && above > below;
      const maxHeight = Math.min(desired, upwards ? above : below);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: upwards ? rect.top - maxHeight - 6 : rect.bottom + 6,
        width,
        maxHeight,
      });
    };
    place();
    const scroll = (e: Event) => {
      if (!popup.current?.contains(e.target as Node)) place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open)
      popup.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        data-value={value}
        title={compact ? `${label}: ${current?.label ?? ""}` : undefined}
        className={`select-trigger ${compact ? "select-compact" : ""} ${className}`}
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            return;
          }
          if (e.key === "Tab") {
            setOpen(false);
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            if (!open) show();
            else
              setActive((i) =>
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? options.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          options.length - 1,
                          i + (e.key === "ArrowDown" ? 1 : -1),
                        ),
                      ),
              );
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (open) commit(active);
            else show();
          } else if (
            e.key.length === 1 &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
          ) {
            const now = Date.now();
            typeahead.current.text =
              (now - typeahead.current.time < 700
                ? typeahead.current.text
                : "") + e.key.toLocaleLowerCase();
            typeahead.current.time = now;
            const index = options.findIndex((o) =>
              o.label.toLocaleLowerCase().startsWith(typeahead.current.text),
            );
            if (index >= 0) {
              e.preventDefault();
              setOpen(true);
              setActive(index);
            }
          }
        }}
      >
        {icon ?? (!compact && current?.icon)}
        {!compact && (
          <span className="select-value">{current?.label ?? value}</span>
        )}
        {!compact && <ChevronDown size={15} className="select-chevron" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="listbox"
            aria-label={label}
            className="select-popup"
            style={position}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={option.value === value}
                data-index={index}
                className={`select-option ${index === active ? "highlighted" : ""}`}
                onPointerMove={() => setActive(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(index)}
              >
                {option.icon}
                <span>{option.label}</span>
                {option.value === value && <Check size={15} />}
              </div>
            ))}
          </div>,
          trigger.current?.closest<HTMLElement>('[role="dialog"]') ??
            document.body,
        )}
    </>
  );
}
