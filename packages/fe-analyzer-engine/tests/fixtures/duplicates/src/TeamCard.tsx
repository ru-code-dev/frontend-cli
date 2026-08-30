// Fixture: the copy. Same structure as `UserCard`, different names and strings — the case
// the MinHash sketch is built to survive.
interface TeamCardProps {
  readonly name: string;
  readonly description: string;
  readonly onSelect: () => void;
}

export function TeamCard({ name, description, onSelect }: TeamCardProps) {
  const label = name.trim();
  const summary = description.trim();

  return (
    <article className="team-card">
      <header className="team-card__header">
        <h3 className="team-card__title">{label}</h3>
        <p className="team-card__caption">{summary}</p>
      </header>
      <footer className="team-card__footer">
        <button type="button" className="team-card__action" onClick={onSelect}>
          Открыть команду
        </button>
      </footer>
    </article>
  );
}
