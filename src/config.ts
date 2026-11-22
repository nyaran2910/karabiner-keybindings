import { constants, copyFileSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

type Input = Record<string, unknown> & { modifiers?: { mandatory?: string[]; optional?: string[] } };
export type Output = Record<string, unknown> & {
  modifiers?: string[];
  shell_command?: string;
  software_function?: { open_application?: { file_path?: string; bundle_identifier?: string } };
};
export const outputPhases = ["to", "to_after_key_up"] as const;
export type Outputs = Partial<Record<(typeof outputPhases)[number], Output[]>>;

type Mapping = {
  type?: string;
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

export type Binding = { profile: string; group: string; mapping: Mapping; complex: boolean; remove: () => void };
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
  if (!Array.isArray(config.profiles)) throw new Error("No Karabiner profiles found.");

  const bindings: Binding[] = [];
  for (const profile of config.profiles) {
    const add = (group: string, mappings: Mapping[] = [], removeEmptyRule?: () => void) => {
      for (const mapping of mappings) {
        bindings.push({ profile: profile.name, group, mapping, complex: !!removeEmptyRule, remove: () => {
          mappings.splice(mappings.indexOf(mapping), 1);
          if (!mappings.length) removeEmptyRule?.();
        } });
      }
    };
    const rules = profile.complex_modifications?.rules ?? [];
    for (const rule of rules) {
      add(rule.description, rule.manipulators, () => rules.splice(rules.indexOf(rule), 1));
    }
    add("Simple Modifications", profile.simple_modifications);
    add("Function Keys", profile.fn_function_keys);
    for (const device of profile.devices ?? []) {
      const label = [device.identifiers?.vendor_id, device.identifiers?.product_id].join("/");
      add("Device " + label + " Simple Modifications", device.simple_modifications);
      add("Device " + label + " Function Keys", device.fn_function_keys);
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
  return [...(input.modifiers?.mandatory ?? []), key ? keyLabel(key.code) : "Special Input"].join(" + ");
}

function outputLabel(output: Output) {
  const application = output.software_function?.open_application;
  if (application) return (application.file_path?.split("/").pop()?.replace(/\.app$/, "") || application.bundle_identifier || "Open Application");
  const command = output.shell_command;
  if (command) {
    const space = command.match(/yabai -m window --space (\d+)/);
    if (space) return "Move Window to Space " + space[1];
    const audio = command.match(/SwitchAudioSource -t (input|output) -s "([^"]+)"/);
    if (audio) return "Switch Audio " + (audio[1] === "input" ? "Input" : "Output") + " to " + audio[2];
    if (command.includes("pmset sleepnow")) return "Sleep Mac";
    const rectangle = command.match(/rectangle-pro:\/\/execute-action\?name=([\w-]+)/);
    if (rectangle) return "Rectangle Pro · " + rectangle[1].replaceAll("-", " ");
    const app = command.match(/tell application "(?!System Events")([^"]+)"/)?.[1]
      ?? command.match(/count windows of process "([^"]+)"/)?.[1];
    if (app && command.includes("Move Tab to New Window")) return "Move " + app + " Tab to New Window";
    if (app && /new window|workspace:new-window/.test(command)) return "Open New " + app + " Window";
    return command;
  }
  const key = keyOf(output);
  if (key) return [...(output.modifiers ?? []), keyLabel(key.code)].join(" + ");
  return Object.keys(output).join(", ");
}

export function actionLabel(mapping: Mapping) {
  return mapping.description || [...(mapping.to ?? []), ...(mapping.to_after_key_up ?? [])].map(outputLabel).join(" → ") || "No Output";
}

function updateConfig(snapshot: Snapshot, update: (current: Snapshot) => void) {
  const current = loadConfig(snapshot.path);
  const ensureUnchanged = () => {
    if (realpathSync(snapshot.path) !== snapshot.target || readFileSync(snapshot.target, "utf8") !== snapshot.raw) {
      throw new Error("The configuration has changed. Reload the list and try again.");
    }
  };
  ensureUnchanged();
  update(current);
  const temporary = snapshot.target + "." + randomUUID() + ".tmp";
  const mode = statSync(snapshot.target).mode & 0o777;
  writeFileSync(temporary, JSON.stringify(current.config, null, 4) + "\n", { mode, flag: "wx" });
  try {
    ensureUnchanged();
    copyFileSync(snapshot.target, snapshot.target + ".raycast-backup", constants.COPYFILE_FICLONE);
    ensureUnchanged();
    renameSync(temporary, snapshot.target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function commitShortcut(snapshot: Snapshot, index: number, type: string, code: string, mandatory: string[], outputs: Outputs = {}) {
  updateConfig(snapshot, (current) => {
    const binding = current.bindings[index];
    const old = keyOf(binding.mapping.from);
    if (!old || !keyTypes.includes(type) || !code) throw new Error("Select an input key.");
    const from = { ...binding.mapping.from };
    delete from[old.type];
    from[type] = code;
    if (binding.complex && (mandatory.length || from.modifiers)) {
      from.modifiers = { ...from.modifiers, mandatory };
      if (!mandatory.length) delete from.modifiers.mandatory;
    }
    binding.mapping.from = from;
    for (const phase of outputPhases) {
      if (outputs[phase]) binding.mapping[phase] = outputs[phase];
    }
  });
}

export function addBinding(snapshot: Snapshot, profileName: string, description: string, type: string, code: string, mandatory: string[], outputs: Outputs) {
  updateConfig(snapshot, ({ config }) => {
    const profile = config.profiles?.find(({ name }) => name === profileName);
    if (!profile) throw new Error("Select a profile.");
    if (!description.trim()) throw new Error("Enter a name for the keybinding.");
    const from: Input = { [type]: code };
    if (mandatory.length) from.modifiers = { mandatory };
    const complex = profile.complex_modifications ??= {};
    const rules = complex.rules ??= [];
    rules.push({
      description: description.trim(),
      manipulators: [{ type: "basic", from, ...outputs }],
    });
  });
}

export function deleteBinding(snapshot: Snapshot, index: number) {
  updateConfig(snapshot, ({ bindings }) => bindings[index].remove());
}
