// Fixture: plain CSS + JSX. Every violation below is seeded on purpose; the counts the
// suite asserts are in `tests/rules.a11y.test.ts`.
import "./app.css";

export function Avatar() {
  // a11y.lint / alt-text: an image with no alt attribute.
  return <img src="/avatar.png" className="avatar" />;
}

export function Toolbar() {
  return (
    <div className="toolbar">
      {/* a11y.aria.invalid / unknownRole: `buton` is one edit away from `button`. */}
      <span role="buton">Сохранить</span>

      {/* a11y.name.missing / iconOnly: a button whose only child is a glyph. */}
      <button className="icon-button" type="button">
        <svg viewBox="0 0 16 16" width="16" height="16">
          <path d="M2 2 L14 14" />
        </svg>
      </button>

      {/* Named the ordinary way — must NOT be reported. */}
      <button className="labelled" type="button">
        Отмена
      </button>
    </div>
  );
}
