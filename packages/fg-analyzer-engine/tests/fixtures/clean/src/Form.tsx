// Negative fixture: a small, correctly built form. A rule that fires here is a false
// positive, and the suite asserts zero findings across all three domains.
import "./form.css";

interface FormProps {
  readonly onSubmit: () => void;
}

export function Form({ onSubmit }: FormProps) {
  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="form__label" htmlFor="email">
        Электронная почта
      </label>
      <input className="form__input" id="email" type="email" name="email" />

      <label className="form__label">
        Комментарий
        <textarea className="form__input" name="comment" />
      </label>

      <img className="form__logo" src="/logo.png" alt="Логотип компании" />

      <button className="form__submit" type="submit">
        Отправить
      </button>
    </form>
  );
}
