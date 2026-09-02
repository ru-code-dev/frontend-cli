import { Button } from "@sds-eng/base";

import styles from "./overrides.module.css";

export const Actions = () => (
  <div className={styles.typo}>
    <Button className={styles.kitButton} classes={{ spinner: styles.kitButtonSpinner }}>
      Save
    </Button>
    <Button className={styles.kitButtonShout}>Shout</Button>
  </div>
);
