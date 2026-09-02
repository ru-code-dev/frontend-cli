// Fixture: the original of a copy-paste pair. `component.duplicate` compares the project
// against itself — identifier-free AST shingles, so renaming does not hide the copy.
interface UserCardProps {
  readonly title: string;
  readonly subtitle: string;
  readonly onOpen: () => void;
}

export function UserCard({ title, subtitle, onOpen }: UserCardProps) {
  const heading = title.trim();
  const caption = subtitle.trim();

  return (
    <article className="user-card">
      <header className="user-card__header">
        <h3 className="user-card__title">{heading}</h3>
        <p className="user-card__caption">{caption}</p>
      </header>
      <footer className="user-card__footer">
        <button type="button" className="user-card__action" onClick={onOpen}>
          Открыть профиль
        </button>
      </footer>
    </article>
  );
}
