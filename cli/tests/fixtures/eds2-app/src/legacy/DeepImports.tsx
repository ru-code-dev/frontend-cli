import * as React from "react";

import { Button } from "@sds-eng/base-exp/dist/components/Button/Button";
import { themeTokens } from "@sds-eng/base-exp/dist/theme/themeTokens.css";
import { Check } from "lucide-react";

/**
 * Pre-migration screen: still on the deep paths the 1.x codemod produced, and on
 * an icon pack that predates the kit's own set.
 */
export const LegacyToolbar: React.FC = () => (
  <div style={{ color: themeTokens.edsSys.Foreground.foreParagraph, gap: 13 }}>
    <Button view="primary">
      <Check size={16} />
      Готово
    </Button>
  </div>
);
