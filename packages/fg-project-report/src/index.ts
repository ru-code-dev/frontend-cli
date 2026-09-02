/**
 * `@smart-tools/fg-project-report` — the feature package, and the boundary in front of three
 * engines.
 *
 * `cli` imports `projectReportCommands` and spreads it into the registry; adding a feature to
 * the product is a new package plus one import line (design 2.1:79-81). Everything that knows
 * what `@smart-tools/fg-source`, `@smart-tools/fg-analyzer-engine` and
 * `@smart-tools/fg-analyzer-report` are lives behind this door — `command.ts` is the only
 * module in the repo that imports any of the three.
 *
 * The surface is small on purpose. `projectReportCommands` is what the product consumes;
 * `createProjectReportCommands` exists for the tier-1 suites, which drive the REAL handler and
 * the REAL `payloadOf` against injected stand-ins for the three expensive seams; the strings
 * are exported so a test can assert on the message a code maps to without re-typing it, which
 * is how a test becomes a translation check rather than a copy of the implementation.
 */
export {
  createProjectReportCommands,
  defaultReportPath,
  projectReportCommands,
  selectFormats,
  targetsFor,
  type ProjectReportDeps,
  type WriteTarget,
} from "./command.ts";

export {
  CONFIG_FILE,
  CONFIG_SCHEMA_FILE,
  DEFAULT_REPORT_FORMAT,
  FILE_FORMAT_EXTENSION,
  FILE_LEVELS,
  INHERIT_LEVEL,
  isFileFormat,
  REPORT_FORMATS,
  type FileLevel,
  type ReportFormat,
} from "./config/names.ts";

export {
  builtinLabelOf,
  configDocumentOf,
  describeKey,
  ruleEntriesOf,
  schemaDocumentOf,
  serialise,
  type BuiltinLevel,
  type RuleEntry,
} from "./config/files.ts";

export {
  DEFAULTS,
  discoverConfig,
  parseConfig,
  unknownRuleIds,
  type ConfigOutcome,
  type DiscoverConfigOptions,
  type LoadedConfig,
} from "./config/load.ts";

export {
  createInitConfigCommands,
  DEFAULT_CONFIG_OUT,
  initConfigCommands,
  type InitConfigDeps,
} from "./init-config.ts";

export {
  createParseUiKitCommands,
  parsableKitNames,
  PARSABLE_KITS,
  parseUiKitCommands,
  type ParsableKit,
  type ParseUiKitDeps,
} from "./parse-ui-kit.ts";

export {
  ADAPTERS,
  NO_ADAPTER,
  resolveAdapter,
  type AdapterResolution,
  adapterNames,
  countKitImports,
  declaredDependencies,
  isRedirectable,
  redirectedChoice,
  requestedAdapter,
  selectAdapter,
  type AdapterChoice,
  type AdapterEntry,
  type SelectAdapterOptions,
} from "./adapters.ts";

export {
  adapterDisabled,
  adapterNotFound,
  configArgDescriptions,
  configBadCategory,
  configBadIgnore,
  configBadLevel,
  configBadUiKit,
  configExists,
  configNotAnObject,
  configNotFound,
  configNotJson,
  configUnknownKey,
  configUnknownRules,
  configUnreadable,
  initConfigArgDescriptions,
  initConfigFailed,
  initConfigNoKit,
  initConfigPhases,
  initConfigSummary,
  initConfigWritten,
  unknownFormat,
  outWithoutFile,
  configSource,
  type InitConfigCounts,
  adapterSelected,
  adapterStamp,
  argDescriptions,
  corpusWarning,
  corpusWritten,
  failed,
  failedToParse,
  missingKit,
  missingSource,
  missingSourceDetail,
  npmFailure,
  parseArgDescriptions,
  parsePhases,
  parseSummary,
  phases,
  provenanceLabel,
  reportReady,
  filesRow,
  findingsRow,
  hiddenRow,
  formatRowKey,
  headerNames,
  kitHeader,
  kitVersionHeader,
  noKitHeader,
  phaseUnits,
  rowKeys,
  writtenFormats,
  sourceFailure,
  summary,
  unknownAdapter,
  unknownParseKit,
  type CorpusCounts,
  type ReportCounts,
} from "./strings.ts";
