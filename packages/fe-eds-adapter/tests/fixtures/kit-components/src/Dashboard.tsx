import { Spinner } from "./Spinner.tsx";
import { StatusRibbon } from "./StatusRibbon.tsx";
import { TeamCard } from "./TeamCard.tsx";
import { ToolbarShell } from "./Toolbar.tsx";
import { UserCard } from "./UserCard.tsx";

export const Dashboard = () => (
  <section>
    <Spinner size="md" />
    <StatusRibbon tone="ok" label="fine" />
    <ToolbarShell>tools</ToolbarShell>
    <UserCard name="Di" role="pm" avatar="/d.png" />
    <TeamCard name="Ed" role="sre" avatar="/e.png" />
    <TeamCard name="Fi" role="ux" avatar="/f.png" />
  </section>
);
