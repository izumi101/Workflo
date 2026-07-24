import { useEffect, useRef } from "react";
import type { ChipView, FieldKey } from "./types.js";

export interface ChipRailProps {
  chips: ChipView[];
  focusIndex: number | null;
  candidatePickerField: FieldKey | null;
  onFocusChange: (index: number | null) => void;
  onRemove: (field: FieldKey) => void;
  onOpenCandidates: (field: FieldKey) => void;
  onCloseCandidates: () => void;
  onResolveCandidate: (field: FieldKey, candidateId: string) => void;
  /** When false (the shared-results page), chips render but aren't keyboard-focusable/removable. */
  interactive?: boolean;
}

/**
 * The editable chip rail (§2.3). Bijective with the AST: every chip here is
 * one clause, `×`/Backspace removes exactly that clause. Roving-tabindex
 * keyboard nav (←/→ between chips, Enter opens a tentative chip's candidate
 * list, Backspace/Delete removes the focused chip) — mirrors the
 * highlight-index conventions already shipped in `GlobalSearch`/
 * `NotificationBell`, just applied to a `role="toolbar"` instead of a
 * `role="listbox"` per the brief.
 */
export function ChipRail({
  chips,
  focusIndex,
  candidatePickerField,
  onFocusChange,
  onRemove,
  onOpenCandidates,
  onCloseCandidates,
  onResolveCandidate,
  interactive = true,
}: ChipRailProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (focusIndex !== null) {
      buttonRefs.current[focusIndex]?.focus();
    }
  }, [focusIndex]);

  if (chips.length === 0) return null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number, chip: ChipView) {
    if (!interactive) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onFocusChange(Math.min(index + 1, chips.length - 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (index === 0) {
        onFocusChange(null); // back to the text input
      } else {
        onFocusChange(index - 1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (chip.state === "tentative") {
        if (candidatePickerField === chip.field) {
          onCloseCandidates();
        } else {
          onOpenCandidates(chip.field);
        }
      }
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      onRemove(chip.field);
      onFocusChange(index > 0 ? index - 1 : null);
    } else if (e.key === "Escape" && candidatePickerField === chip.field) {
      e.preventDefault();
      e.stopPropagation();
      onCloseCandidates();
    }
  }

  return (
    <div className="chip-rail" role="toolbar" aria-label="Active filters">
      {chips.map((chip, index) => {
        const classes = ["chip", `chip--${chip.state}`];
        return (
          <div className="chip-rail__item" key={chip.field}>
            <button
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              type="button"
              className={classes.join(" ")}
              tabIndex={interactive ? (focusIndex === index ? 0 : -1) : -1}
              aria-haspopup={chip.state === "tentative" ? "listbox" : undefined}
              aria-expanded={chip.state === "tentative" ? candidatePickerField === chip.field : undefined}
              onFocus={() => interactive && onFocusChange(index)}
              onKeyDown={(e) => handleKeyDown(e, index, chip)}
              onClick={() => {
                if (!interactive) return;
                if (chip.state === "tentative") {
                  onOpenCandidates(chip.field);
                }
              }}
            >
              <span className="chip__field">{chip.fieldLabel}</span>
              <span className="chip__colon">:</span>
              <span className="chip__value">{chip.valueLabel}</span>
              {chip.state === "tentative" ? <span className="chip__marker">?</span> : null}
              {interactive ? (
                <span
                  className="chip__remove"
                  role="button"
                  aria-label={`Remove ${chip.fieldLabel} filter`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(chip.field);
                  }}
                >
                  ×
                </span>
              ) : null}
            </button>

            {chip.state === "tentative" && candidatePickerField === chip.field && chip.candidates ? (
              <ul className="chip-candidates" role="listbox" aria-label={`${chip.fieldLabel} candidates`}>
                {chip.candidates.map((c) => (
                  <li key={c.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="chip-candidates__item"
                      onClick={() => onResolveCandidate(chip.field, c.id)}
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
