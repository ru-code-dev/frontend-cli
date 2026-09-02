import { useState } from "react";

export const ConfirmDialog = ({ open }: { open: boolean }) => {
  const [visible, setVisible] = useState(open);

  return visible ? (
    <div role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">Are you sure?</h2>
      <button type="button" onClick={() => setVisible(false)}>
        Yes
      </button>
    </div>
  ) : null;
};
