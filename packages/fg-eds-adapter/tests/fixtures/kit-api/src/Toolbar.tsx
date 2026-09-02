import { Button, BrowserTabs } from "@sds-eng/base";
import { Tooltip } from "@sds-eng/base/src/components/Tooltip/Tooltip";
import { Button as RawButton } from "@v-uik/button";
import { legacyHelper } from "@sds-eng/base/_DNU_ST_/helpers";

export const Toolbar = () => (
  <div className="toolbar">
    <Button view="danger" size="xl">
      Delete
    </Button>
    <Button view="secondary" size="md">
      Cancel
    </Button>
    <BrowserTabs items={[]} />
    <RawButton>Raw</RawButton>
    <Tooltip title={legacyHelper()}>
      <span>help</span>
    </Tooltip>
  </div>
);
