import * as React from "react";

import { Button, PasswordField, TextField } from "@sds-eng/kit-exp";

import { form, errorText, submitRow } from "./LoginForm.css";

export interface LoginFormProps {
  error: string | null;
  onSubmit: (login: string, password: string) => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ error, onSubmit }) => {
  const [login, setLogin] = React.useState("");
  const [password, setPassword] = React.useState("");

  return (
    <form
      className={form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(login, password);
      }}
    >
      <TextField
        label="Логин"
        name="login"
        onChange={(event) => setLogin(event.target.value)}
        value={login}
      />
      <PasswordField
        label="Пароль"
        name="password"
        onChange={(event) => setPassword(event.target.value)}
        value={password}
      />
      {error ? <p className={errorText}>{error}</p> : null}
      <div className={submitRow}>
        <Button kind="ghost" size="md" view="secondary">
          Отмена
        </Button>
        <Button size="lg" type="submit" view="error">
          Войти
        </Button>
      </div>
    </form>
  );
};
