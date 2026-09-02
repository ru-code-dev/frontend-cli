import { Button } from "@sds-eng/base";

import styles from "./panel.module.css";

export const Panel = ({ title }: { title: string }) => (
  <section className={styles.panel}>
    <h2 className={styles.heading}>{title}</h2>
    <div className={styles.accent} />
    <div className={styles.figure} />
    <div className={styles.grid} />
    <div className={styles.dense} />
    <button type="button" className={styles.quiet}>
      Quiet
    </button>
    <Button className={styles.panel} view="primary">
      Ok
    </Button>
  </section>
);
