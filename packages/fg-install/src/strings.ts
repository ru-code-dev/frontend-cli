/**
 * Every user-facing string of `fg install` / `fg install --check` / `fg uninstall`, in both
 * languages (PROTOCOL §4: `Localized {ru,en}`, default ru). Paths and command lines are the same
 * in both and are interpolated, never translated.
 */
import type { CommandGroup, Localized } from "@smart-tools/fg-cli-kit";

import type { ManifestProblem } from "./payload.ts";

const same = (text: string): Localized => ({ ru: text, en: text });

/** The `fg --help` section these commands live under. After pixso (1) and analysis (2). */
export const ruCodeGroup: CommandGroup = {
  id: "ru-code",
  title: { ru: "Плагин для ru-code", en: "ru-code plugin" },
  order: 3,
};

export const installSummary: Localized = {
  ru: "установить плагин pixso в ru-code",
  en: "install the pixso plugin into ru-code",
};

export const uninstallSummary: Localized = {
  ru: "удалить плагин pixso из ru-code",
  en: "remove the pixso plugin from ru-code",
};

export const installDetails: Localized = {
  ru:
    "Находит ru-code тем же preflight-скриптом, которым пользуется установщик ru-code, и кладёт " +
    "встроенную в fg сборку плагина pixso в <корень ru-code>/plugins/pixso. Замена атомарная: " +
    "прежняя папка остаётся целой, пока новая не записана и не сверена по sha256. Данные плагина " +
    "(userdata/plugins/pixso) и переключатели вкл/выкл не трогаются. Если ru-code запущен, он " +
    "перезапускается командой «ru-code restart --no-browser»; если не запущен, плагин загрузится " +
    "при следующем старте. Если в папке уже лежат те же файлы (байт в байт), ничего не пишется и " +
    "перезапуска нет. " +
    "Флаг -o здесь не нужен: команда ничего не пишет в текущую папку.",
  en:
    "Locates ru-code with the same preflight script the ru-code installer uses and puts the pixso " +
    "plugin build embedded in fg into <ru-code root>/plugins/pixso. The swap is atomic: the old " +
    "folder stays intact until the new one is written and verified by sha256. Plugin data " +
    "(userdata/plugins/pixso) and the on/off switches are left alone. If ru-code is running it is " +
    'restarted with "ru-code restart --no-browser"; if not, the plugin loads on the next start. ' +
    "When the folder already holds the same files (byte for byte) nothing is written and nothing " +
    "is restarted. " +
    "-o does not apply: the command writes nothing to the current directory.",
};

export const uninstallDetails: Localized = {
  ru:
    "Удаляет папку <корень ru-code>/plugins/pixso — и только её. Данные плагина " +
    "(userdata/plugins/pixso) и переключатели вкл/выкл остаются: при повторной установке плагин " +
    "увидит их снова. Если ru-code запущен, он перезапускается командой " +
    "«ru-code restart --no-browser».",
  en:
    "Removes the folder <ru-code root>/plugins/pixso and nothing else. Plugin data " +
    "(userdata/plugins/pixso) and the on/off switches stay, so a later install finds them again. " +
    'If ru-code is running it is restarted with "ru-code restart --no-browser".',
};

export const checkArg = {
  description: {
    ru:
      "только проверить и ничего не менять: где ru-code, установлен ли плагин и совпадает ли он " +
      "со встроенным, не перекрыт ли копией ru-code, запущен ли ru-code. Код возврата 0 — " +
      "установлен, совпадает и не перекрыт; иначе 1.",
    en:
      "check only, change nothing: where ru-code is, whether the plugin is installed and matches " +
      "the embedded build, whether ru-code's own copy shadows it, whether ru-code is running. " +
      "Exit 0 when installed, identical and not shadowed; 1 otherwise.",
  },
  hint: { ru: "только проверить, ничего не менять", en: "check only, change nothing" },
} as const satisfies Record<string, Localized>;

export const noRestartArg = {
  description: {
    ru: "не перезапускать ru-code, даже если он запущен; плагин загрузится при следующем запуске.",
    en: "do not restart ru-code even if it is running; the plugin loads on the next start.",
  },
  hint: { ru: "не перезапускать ru-code", en: "do not restart ru-code" },
} as const satisfies Record<string, Localized>;

export const headerNames = {
  install: same("install"),
  check: same("install --check"),
  uninstall: same("uninstall"),
} as const;

export const pluginHeader = (id: string, version: string): Localized => same(`${id} ${version}`);

export const phases = {
  preflight: { ru: "поиск ru-code", en: "locating ru-code" },
  verify: { ru: "проверка плагина", en: "checking the plugin" },
  write: { ru: "запись", en: "writing" },
  remove: { ru: "удаление", en: "removing" },
  restart: { ru: "перезапуск ru-code", en: "restarting ru-code" },
} as const satisfies Record<string, Localized>;

export const rowKeys = {
  root: { ru: "ru-code", en: "ru-code" },
  appVersion: { ru: "версия ru-code", en: "ru-code version" },
  minimum: { ru: "нужен", en: "required" },
  checks: { ru: "проверки", en: "checks" },
  target: { ru: "плагин", en: "plugin" },
  data: { ru: "данные", en: "data" },
  state: { ru: "установлен", en: "installed" },
  embedded: { ru: "встроенный", en: "embedded" },
  shadow: { ru: "перекрыт", en: "shadowed" },
  running: { ru: "запущен", en: "running" },
  restart: { ru: "перезапуск", en: "restart" },
} as const satisfies Record<string, Localized>;

/* ── values ──────────────────────────────────────────────────────────────────────────────── */

export const yes: Localized = { ru: "да", en: "yes" };
export const no: Localized = { ru: "нет", en: "no" };

export const stateValues = {
  absent: { ru: "нет", en: "no" },
  identical: { ru: "да, совпадает со встроенным", en: "yes, identical to the embedded build" },
  different: {
    ru: "да, но отличается от встроенного",
    en: "yes, but differs from the embedded build",
  },
} as const satisfies Record<string, Localized>;

export const runningValue = (pid: number): Localized => ({
  ru: `да (pid ${pid})`,
  en: `yes (pid ${pid})`,
});

export const shadowValue = (shippedDir: string): Localized => ({
  ru: `да: ${shippedDir}`,
  en: `yes: ${shippedDir}`,
});

export const shadowUnknownValue: Localized = {
  ru: "неизвестно (нет bin/current.json)",
  en: "unknown (no bin/current.json)",
};

export const appVersionUnknownValue: Localized = {
  ru: "неизвестна (bin/current.json)",
  en: "unknown (bin/current.json)",
};

export const minimumValue = (minimum: string): Localized => same(`≥ ${minimum}`);

export const ruCodeAbsentValue = (cliJs: string): Localized => ({
  ru: `не установлен (нет ${cliJs})`,
  en: `not installed (no ${cliJs})`,
});

export const restartValues = {
  done: { ru: "выполнен: ru-code restart --no-browser", en: "done: ru-code restart --no-browser" },
  notRunning: { ru: "не нужен: ru-code не запущен", en: "not needed: ru-code is not running" },
  unchanged: { ru: "не нужен: файлы не изменились", en: "not needed: nothing changed" },
  skipped: { ru: "пропущен (--no-restart)", en: "skipped (--no-restart)" },
  wouldRun: { ru: "будет при установке", en: "would run on install" },
  wouldNot: { ru: "не понадобится", en: "would not be needed" },
} as const satisfies Record<string, Localized>;

/* ── headlines ───────────────────────────────────────────────────────────────────────────── */

export const installedHeadline = (id: string, version: string): Localized => ({
  ru: `плагин ${id} ${version} установлен`,
  en: `plugin ${id} ${version} installed`,
});

export const replacedHeadline = (id: string, version: string): Localized => ({
  ru: `плагин ${id} ${version} установлен поверх прежнего`,
  en: `plugin ${id} ${version} installed over the previous copy`,
});

export const alreadyHeadline = (id: string, version: string): Localized => ({
  ru: `плагин ${id} ${version} уже установлен`,
  en: `plugin ${id} ${version} is already installed`,
});

export const restartFailedHeadline = (id: string, version: string): Localized => ({
  ru: `плагин ${id} ${version} установлен, но ru-code не перезапустился`,
  en: `plugin ${id} ${version} installed, but ru-code did not restart`,
});

export const uninstalledHeadline = (id: string): Localized => ({
  ru: `плагин ${id} удалён`,
  en: `plugin ${id} removed`,
});

export const uninstallRestartFailedHeadline = (id: string): Localized => ({
  ru: `плагин ${id} удалён, но ru-code не перезапустился`,
  en: `plugin ${id} removed, but ru-code did not restart`,
});

export const notInstalledHeadline = (id: string): Localized => ({
  ru: `плагин ${id} не был установлен — удалять нечего`,
  en: `plugin ${id} was not installed — nothing to remove`,
});

export const checkHeadlines = {
  ok: (id: string, version: string): Localized => ({
    ru: `плагин ${id} ${version} установлен и совпадает со встроенным`,
    en: `plugin ${id} ${version} is installed and identical to the embedded build`,
  }),
  noRuCode: { ru: "ru-code не установлен", en: "ru-code is not installed" },
  absent: (id: string): Localized => ({
    ru: `плагин ${id} не установлен`,
    en: `plugin ${id} is not installed`,
  }),
  different: (id: string): Localized => ({
    ru: `установлен плагин ${id}, но не тот, что встроен в fg`,
    en: `plugin ${id} is installed, but not the build embedded in fg`,
  }),
  shadowed: (id: string): Localized => ({
    ru: `плагин ${id} установлен, но ru-code загрузит свою копию`,
    en: `plugin ${id} is installed, but ru-code loads its own copy`,
  }),
  shadowUnknown: (id: string): Localized => ({
    ru: `плагин ${id} установлен, но не удалось проверить, не перекрыт ли он копией ru-code`,
    en: `plugin ${id} is installed, but whether ru-code's own copy shadows it could not be checked`,
  }),
} as const;

/* ── notes and warnings ──────────────────────────────────────────────────────────────────── */

export const shadowedWarning = (id: string, version: string, shippedDir: string): Localized => ({
  ru:
    `ru-code ${version} поставляет собственный ${id}: загрузится его копия, а эта будет ` +
    `проигнорирована (${shippedDir})`,
  en:
    `ru-code ${version} ships its own ${id}: that copy is loaded and this one is ignored ` +
    `(${shippedDir})`,
});

export const shadowUnknownWarning: Localized = {
  ru: "не удалось прочитать bin/current.json ru-code — проверка на собственную копию плагина пропущена",
  en: "could not read ru-code's bin/current.json — the check for a bundled copy of the plugin was skipped",
};

export const notRunningNote: Localized = {
  ru: "ru-code не запущен — плагин загрузится при следующем запуске",
  en: "ru-code is not running — the plugin loads on the next start",
};

export const noRestartNote: Localized = {
  ru: "перезапуск пропущен (--no-restart): чтобы применить изменения, выполните ru-code restart",
  en: "restart skipped (--no-restart): run ru-code restart to apply the change",
};

/** The `запись` row's detail when the folder already held these bytes. */
export const unchangedPhase: Localized = { ru: "без изменений", en: "unchanged" };

export const unchangedNote: Localized = {
  ru: "файлы не изменились — перезапуск не нужен; если прошлый запуск был с --no-restart, выполните ru-code restart",
  en: "nothing changed — no restart needed; if the last run used --no-restart, run ru-code restart",
};

export const leftoverWarning = (path: string): Localized => ({
  ru: `не удалось удалить старую копию — удалите её вручную: ${path}`,
  en: `could not remove the old copy — delete it by hand: ${path}`,
});

/* ── failures ────────────────────────────────────────────────────────────────────────────── */

export const noPayload: Localized = {
  ru: "в этой сборке fg нет плагина ru-code",
  en: "this fg build carries no ru-code plugin",
};

export const noPayloadDetail: Localized = {
  ru: "соберите fg заново с папкой vendor/ru-code (docs/CONTRIBUTING.md)",
  en: "rebuild fg with a vendor/ru-code folder (docs/CONTRIBUTING.md)",
};

export const preflightFailed: Localized = {
  ru: "preflight ru-code не сообщил корень приложения (OUR_ROOT)",
  en: "the ru-code preflight did not report the app root (OUR_ROOT)",
};

export const preflightTimedOut: Localized = {
  ru: "preflight ru-code не завершился вовремя и был остановлен",
  en: "the ru-code preflight did not finish in time and was stopped",
};

export const ruCodeNotInstalled: Localized = {
  ru: "ru-code не установлен",
  en: "ru-code is not installed",
};

export const ruCodeNotInstalledDetail = (cliJs: string): Localized => ({
  ru: `нет файла ${cliJs} — сначала установите ru-code`,
  en: `${cliJs} does not exist — install ru-code first`,
});

/** THE VERSION GATE (`MINIMUM_APP_VERSION`): the installed ru-code is older than the plugin needs. */
export const appTooOld = (installed: string, id: string, minimum: string): Localized => ({
  ru: `установлен ru-code ${installed}, а плагину ${id} нужен ${minimum} или новее`,
  en: `ru-code ${installed} is installed, but the ${id} plugin needs ${minimum} or newer`,
});

export const appTooOldDetail: Localized = {
  ru: "обновите ru-code и повторите fg install",
  en: "update ru-code and run fg install again",
};

/** THE VERSION GATE, when `<bin>/current.json` names no `X.Y.Z` version: it cannot be verified. */
export const appVersionUnknown = (id: string, minimum: string): Localized => ({
  ru: `не удалось узнать версию ru-code, а плагину ${id} нужен ${minimum} или новее`,
  en: `could not tell which ru-code version is installed, and the ${id} plugin needs ${minimum} or newer`,
});

export const appVersionUnknownDetail = (pointer: string): Localized => ({
  ru: `в ${pointer} нет версии вида X.Y.Z — обновите или переустановите ru-code и повторите fg install`,
  en: `${pointer} names no X.Y.Z version — update or reinstall ru-code and run fg install again`,
});

export const badManifest: Localized = {
  ru: "встроенный плагин не пройдёт проверку ru-code",
  en: "the embedded plugin would be rejected by ru-code",
};

export function manifestProblem(problem: ManifestProblem): Localized {
  switch (problem.kind) {
    case "missing":
      return { ru: "нет plugin.json", en: "plugin.json is missing" };
    case "json":
      return {
        ru: `plugin.json не читается: ${problem.detail}`,
        en: `plugin.json is unreadable: ${problem.detail}`,
      };
    case "id":
      return { ru: `недопустимый id «${problem.id}»`, en: `invalid id "${problem.id}"` };
    case "folder":
      return {
        ru: `id «${problem.id}» не совпадает с именем папки «${problem.folder}»`,
        en: `id "${problem.id}" does not match the folder name "${problem.folder}"`,
      };
    case "api":
      return {
        ru: `apiVersion ${problem.apiVersion}, а ru-code загружает только 2`,
        en: `apiVersion ${problem.apiVersion}, but ru-code loads only 2`,
      };
    case "version":
      return { ru: "нет поля version", en: "the version field is missing" };
    case "entry":
      return {
        ru: `${problem.field} «${problem.value}» не указывает на файл внутри плагина`,
        en: `${problem.field} "${problem.value}" does not name a file inside the plugin`,
      };
  }
}

export const installFailed = (detail: string): Localized => ({
  ru: `не удалось установить плагин: ${detail}`,
  en: `could not install the plugin: ${detail}`,
});

export const installFailedDetail: Localized = {
  ru: "прежняя папка плагина (если была) осталась на месте",
  en: "the previous plugin folder (if any) was left in place",
};

/** A live `fg install` / `fg uninstall` of the same plugin holds the lock — refuse, do not wait. */
export const alreadyRunning = (pid: number | undefined): Localized => ({
  ru: `другой запуск fg install/uninstall уже работает${pid === undefined ? "" : ` (pid ${pid})`}`,
  en: `another fg install/uninstall is already running${pid === undefined ? "" : ` (pid ${pid})`}`,
});

export const alreadyRunningDetail = (lockPath: string): Localized => ({
  ru: `дождитесь его окончания и повторите; если такого запуска нет, удалите папку ${lockPath}`,
  en: `wait for it to finish and retry; if no such run exists, delete the folder ${lockPath}`,
});

export const uninstallFailed = (detail: string): Localized => ({
  ru: `не удалось удалить плагин: ${detail}`,
  en: `could not remove the plugin: ${detail}`,
});

export const restartFailedDetail = (code: number | null, tail: string): Localized => ({
  ru: `ru-code restart --no-browser завершился с кодом ${String(code)}${tail === "" ? "" : `: ${tail}`} — перезапустите вручную: ru-code restart`,
  en: `ru-code restart --no-browser exited with ${String(code)}${tail === "" ? "" : `: ${tail}`} — restart it by hand: ru-code restart`,
});

export const unexpectedArgument = (value: string): Localized => ({
  ru: `лишний аргумент: ${value}`,
  en: `unexpected argument: ${value}`,
});
