import * as React from "react";

import { Button } from "@sds-eng/kit-exp";

import { backdrop, panel } from "./ProfileDialog.css";

export interface ProfileDialogProps {
  open: boolean;
  avatarUrl: string;
  onClose: () => void;
}

/**
 * Hand-rolled dialog: the kit's `Modal` is not used, and neither is any of the
 * focus handling it brings with it.
 */
export const ProfileDialog: React.FC<ProfileDialogProps> = ({ open, avatarUrl, onClose }) => {
  if (!open) {
    return null;
  }

  return (
    <div className={backdrop} onClick={onClose}>
      <div className={panel} role="dialog">
        <img src={avatarUrl} width={64} />
        <h2>Профиль</h2>
        <div aria-checked="true" onClick={onClose}>
          Свернуть
        </div>
        <Button aria-labell="Закрыть" onClick={onClose} view="primary">
          Закрыть
        </Button>
      </div>
    </div>
  );
};
