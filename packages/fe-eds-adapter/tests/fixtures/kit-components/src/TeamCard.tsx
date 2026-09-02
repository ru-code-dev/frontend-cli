export interface TeamCardProps {
  name: string;
  role: string;
  avatar: string;
  onOpen?: () => void;
}

export const TeamCard = ({ name, role, avatar, onOpen }: TeamCardProps) => (
  <article className="team-card" onClick={onOpen}>
    <header className="team-card__head">
      <img className="team-card__avatar" src={avatar} alt="" />
      <div className="team-card__titles">
        <h3 className="team-card__name">{name}</h3>
        <p className="team-card__role">{role}</p>
      </div>
    </header>
    <footer className="team-card__foot">
      <span className="team-card__badge">active</span>
    </footer>
  </article>
);
