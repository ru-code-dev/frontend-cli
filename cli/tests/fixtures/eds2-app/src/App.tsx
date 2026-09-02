import * as React from "react";

import { Button, Text } from "@sds-eng/kit-exp";

import { IconLegend } from "./components/IconLegend";
import { PrimaryButton } from "./components/PrimaryButton";
import { StatusBadge } from "./components/StatusBadge";
import { LoginForm } from "./features/LoginForm";
import { ProfileDialog } from "./features/ProfileDialog";
import { useDraft } from "./hooks/useDraft";
import { LegacyToolbar } from "./legacy/DeepImports";
import "./styles/global.css";
import { page, section } from "./theme/tokens.css";

export const App: React.FC = () => {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = useDraft();

  return (
    <main className={page}>
      <section className={section}>
        <Text>Личный кабинет, {draft.login}</Text>
        <StatusBadge label="Черновик" onDismiss={() => setError(null)} />
        <IconLegend />
      </section>

      <LoginForm
        error={error}
        onSubmit={(login) => {
          setDraft({ login, updatedAt: Date.now() });
          setError(null);
        }}
      />

      <div className={section}>
        <Button kind="outlined" onClick={() => setDialogOpen(true)} size="sm">
          Открыть профиль
        </Button>
        <PrimaryButton tone="exotic">Сохранить</PrimaryButton>
      </div>

      <LegacyToolbar />

      <ProfileDialog
        avatarUrl="/avatar.png"
        onClose={() => setDialogOpen(false)}
        open={dialogOpen}
      />
    </main>
  );
};
