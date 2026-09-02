export interface UserCardProps {
  name: string;
  role: string;
  avatar: string;
  onOpen?: () => void;
}

export const UserCard = ({ name, role, avatar, onOpen }: UserCardProps) => (
  <article className="user-card" onClick={onOpen}>
    <header className="user-card__head">
      <img className="user-card__avatar" src={avatar} alt="" />
      <div className="user-card__titles">
        <h3 className="user-card__name">{name}</h3>
        <p className="user-card__role">{role}</p>
      </div>
    </header>
    <footer className="user-card__foot">
      <span className="user-card__badge">active</span>
    </footer>
  </article>
);
