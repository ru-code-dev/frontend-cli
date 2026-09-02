// Fixture: CSS modules. Seeds the three rules that read ARIA off the element itself.
import styles from "./panel.module.css";

export function Panel() {
  return (
    <section className={styles.root}>
      {/* a11y.aria.required: role="checkbox" must carry aria-checked. */}
      <span role="checkbox" className={styles.box} tabIndex={0}>
        Показывать архив
      </span>

      {/* a11y.aria.redundant: <button> already has role="button". */}
      <button role="button" type="button" className={styles.action}>
        Применить
      </button>

      {/* a11y.pattern.relations / danglingId: no element in this file carries that id. */}
      <div aria-labelledby="panel-heading-missing" className={styles.body}>
        Содержимое
      </div>
    </section>
  );
}
