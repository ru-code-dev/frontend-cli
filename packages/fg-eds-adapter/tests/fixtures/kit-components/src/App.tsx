import { Button } from "@sds-eng/base";

import { Card } from "./Card.tsx";
import { MyButton } from "./MyButton.tsx";
import { StatusRibbon } from "./StatusRibbon.tsx";
import { TeamCard } from "./TeamCard.tsx";
import { ToolbarShell } from "./Toolbar.tsx";
import { UserCard } from "./UserCard.tsx";

export const App = () => (
  <main>
    <Button view="primary">Kit</Button>
    <MyButton view="secondary">Local</MyButton>
    <ToolbarShell>bar</ToolbarShell>
    <Card accent>boxed</Card>
    <StatusRibbon tone="ok" label="up" />
    <StatusRibbon tone="warn" label="slow" />
    <UserCard name="Ann" role="dev" avatar="/a.png" />
    <UserCard name="Bo" role="ops" avatar="/b.png" />
    <TeamCard name="Cy" role="qa" avatar="/c.png" />
  </main>
);
