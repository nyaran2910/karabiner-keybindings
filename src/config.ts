import { constants, copyFileSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

type Input = Record<string, unknown> & { modifiers?: { mandatory?: string[]; optional?: string[] } };
type Output = Record<string, unknown> & {
  modifiers?: string[];
  shell_command?: string;
  software_function?: { open_application?: { file_path?: string; bundle_identifier?: string } };
};
type Mapping = {
  from: Input;
  description?: string;
  to?: Output[];
  to_after_key_up?: Output[];
  conditions?: { bundle_identifiers?: string[] }[];
};
type Scope = { simple_modifications?: Mapping[]; fn_function_keys?: Mapping[] };
type Profile = Scope & {
  name: string;
  selected?: boolean;
  devices?: (Scope & { identifiers?: { vendor_id?: number; product_id?: number } })[];
  complex_modifications?: { rules?: { description: string; manipulators: Mapping[] }[] };
};

export type Binding = { profile: string; group: string; mapping: Mapping; complex: boolean };
export type Snapshot = ReturnType<typeof loadConfig>;

export const keyTypes = ["key_code", "consumer_key_code", "pointing_button", "apple_vendor_top_case_key_code", "apple_vendor_keyboard_key_code"];
export const modifiers = ["command", "control", "option", "shift", "fn", "caps_lock",
  ...["command", "control", "option", "shift"].flatMap((name) => ["left_" + name, "right_" + name])];

export const keys = {
  key_code: [
    ..."abcdefghijklmnopqrstuvwxyz0123456789",
    ...Array.from({ length: 24 }, (_, i) => "f" + (i + 1)),
    "escape", "spacebar", "return_or_enter", "tab", "delete_or_backspace", "delete_forward",
    "up_arrow", "down_arrow", "left_arrow", "right_arrow", "home", "end", "page_up", "page_down",
    "hyphen", "equal_sign", "open_bracket", "close_bracket", "backslash", "semicolon", "quote",
    "grave_accent_and_tilde", "comma", "period", "slash", "caps_lock", "fn",
    ...modifiers.filter((name) => name.startsWith("left_") || name.startsWith("right_")),
    ...Array.from({ length: 9 }, (_, i) => "international" + (i + 1)),
    ...Array.from({ length: 10 }, (_, i) => "keypad_" + i),
    "japanese_eisuu", "japanese_kana", "keypad_enter", "keypad_period", "keypad_plus",
    "keypad_hyphen", "keypad_asterisk", "keypad_slash", "keypad_equal_sign", "keypad_num_lock",
  ],
  consumer_key_code: ["rewind", "play_or_pause", "fast_forward", "scan_previous_track", "scan_next_track",
    "mute", "volume_decrement", "volume_increment", "display_brightness_decrement", "display_brightness_increment"],
  pointing_button: Array.from({ length: 32 }, (_, i) => "button" + (i + 1)),
  apple_vendor_top_case_key_code: ["keyboard_fn"],
  apple_vendor_keyboard_key_code: [],
};

export function configPath(preference?: string) {
  const defaultDirectory = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return preference?.trim().replace(/^~\//, homedir() + "/") || join(defaultDirectory, "karabiner", "karabiner.json");
}

export function loadConfig(path: string) {
  const target = realpathSync(path);
  const raw = readFileSync(target, "utf8");
  const config = JSON.parse(raw) as { profiles?: Profile[] };
  if (!Array.isArray(config.profiles)) throw new Error("Karabiner のプロファイルが見つかりません。");

  const bindings: Binding[] = [];
  for (const profile of config.profiles) {
    const add = (group: string, mappings: Mapping[] = [], complex = false) => {
      for (const mapping of mappings) bindings.push({ profile: profile.name, group, mapping, complex });
    };
    for (const rule of profile.complex_modifications?.rules ?? []) add(rule.description, rule.manipulators, true);
    add("単純な割り当て", profile.simple_modifications);
    add("ファンクションキー", profile.fn_function_keys);
    for (const device of profile.devices ?? []) {
      const label = [device.identifiers?.vendor_id, device.identifiers?.product_id].join("/");
      add("デバイス " + label + " の割り当て", device.simple_modifications);
      add("デバイス " + label + " のファンクションキー", device.fn_function_keys);
    }
  }
  return { path, target, raw, config, bindings, activeProfile: config.profiles.find((p) => p.selected)?.name };
}

export function keyOf(input: Record<string, unknown>) {
  const type = keyTypes.find((name) => typeof input[name] === "string");
  return type ? { type, code: input[type] as string } : undefined;
}

export function keyLabel(code: string) {
  return code.length === 1 ? code.toUpperCase() : code.replaceAll("_", " ");
}

export function shortcut(input: Input) {
  const key = keyOf(input);
  return [...(input.modifiers?.mandatory ?? []), key ? keyLabel(key.code) : "特殊入力"].join(" + ");
}

function outputLabel(output: Output) {
  const application = output.software_function?.open_application;
  if (application) return (application.file_path?.split("/").pop()?.replace(/\.app$/, "") || application.bundle_identifier || "アプリを開く");
  const command = output.shell_command;
  if (command) {
    const space = command.match(/yabai -m window --space (\d+)/);
    if (space) return "ウィンドウを Space " + space[1] + " に移動";
    const audio = command.match(/SwitchAudioSource -t (input|output) -s "([^"]+)"/);
    if (audio) return (audio[1] === "input" ? "入力" : "出力") + "を " + audio[2] + " に切り替え";
    if (command.includes("pmset sleepnow")) return "Mac をスリープ";
    const rectangle = command.match(/rectangle-pro:\/\/execute-action\?name=([\w-]+)/);
    if (rectangle) return "Rectangle Pro · " + rectangle[1].replaceAll("-", " ");
    const app = command.match(/tell application "(?!System Events")([^"]+)"/)?.[1]
      ?? command.match(/count windows of process "([^"]+)"/)?.[1];
    if (app && command.includes("Move Tab to New Window")) return app + " のタブを新しいウィンドウへ";
    if (app && /new window|workspace:new-window/.test(command)) return app + " の新しいウィンドウを開く";
    return command;
  }
  const key = keyOf(output);
  if (key) return [...(output.modifiers ?? []), keyLabel(key.code)].join(" + ");
  return Object.keys(output).join(", ");
}

export function actionLabel(mapping: Mapping) {
  return mapping.description || [...(mapping.to ?? []), ...(mapping.to_after_key_up ?? [])].map(outputLabel).join(" → ") || "出力なし";
}

function saveShortcut(snapshot: Snapshot, index: number, type: string, code: string, mandatory: string[]) {
  const current = loadConfig(snapshot.path);
  const ensureUnchanged = () => {
    if (realpathSync(snapshot.path) !== snapshot.target || readFileSync(snapshot.target, "utf8") !== snapshot.raw) {
      throw new Error("設定ファイルが更新されています。一覧を再読み込みしてください。");
    }
  };
  ensureUnchanged();
  const binding = current.bindings[index];
  const old = keyOf(binding.mapping.from);
  if (!old || !keyTypes.includes(type) || !code) throw new Error("入力キーを選んでください。");
  const from = { ...binding.mapping.from };
  delete from[old.type];
  from[type] = code;
  if (binding.complex && (mandatory.length || from.modifiers)) {
    from.modifiers = { ...from.modifiers, mandatory };
    if (!mandatory.length) delete from.modifiers.mandatory;
  }
  binding.mapping.from = from;
  const temporary = snapshot.target + "." + randomUUID() + ".tmp";
  const mode = statSync(snapshot.target).mode & 0o777;
  writeFileSync(temporary, JSON.stringify(current.config, null, 4) + "\n", { mode, flag: "wx" });
  return { temporary, ensureUnchanged };
}

export function commitShortcut(snapshot: Snapshot, index: number, type: string, code: string, mandatory: string[]) {
  const { temporary, ensureUnchanged } = saveShortcut(snapshot, index, type, code, mandatory);
  try {
    ensureUnchanged();
    copyFileSync(snapshot.target, snapshot.target + ".raycast-backup", constants.COPYFILE_FICLONE);
    ensureUnchanged();
    renameSync(temporary, snapshot.target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
