import { Action, ActionPanel, Alert, confirmAlert, Form, Icon, List, Toast, getPreferenceValues, showToast, useNavigation } from "@raycast/api";
import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import { useEffect, useState } from "react";
import { addBinding, deleteBinding, actionLabel, commitShortcut, configPath, keyLabel, keyOf, keys, keyTypes, loadConfig, modifiers, shortcut, outputPhases, type Binding, type Output, type Outputs, type Snapshot } from "./config";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const execFileAsync = promisify(execFile);

async function restartKarabinerAfterSave(title: string) {
  try {
    // Karabiner may miss changes when karabiner.json points outside its watched directory.
    await execFileAsync("/bin/launchctl", [
      "kickstart", "-k", `gui/${userInfo().uid}/org.pqrs.service.agent.Karabiner-Console-User-Server`,
    ]);
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: title + ", but Karabiner Could Not Restart",
      message: message(error),
    });
    return;
  }
  await showToast({ style: Toast.Style.Success, title });
}

const actionTypes = [
  { value: "key", title: "Send Keystroke" },
  { value: "shell", title: "Shell Command" },
  { value: "app", title: "Open Application" },
];

function outputType(output: Output) {
  if (typeof output.shell_command === "string") return "shell";
  if (output.software_function?.open_application) return "app";
  if (keyOf(output)) return "key";
  return "other";
}

function OutputFields({ id, output, complex, label }: { id: string; output: Output; complex: boolean; label: string }) {
  const originalType = outputType(output);
  const [type, setType] = useState(originalType);
  if (originalType === "other") return <Form.Description text={actionLabel({ from: {}, to: [output] })} />;
  const key = keyOf(output);
  const app = output.software_function?.open_application;
  return <>
    <Form.Separator />
    <Form.Description text={label} />
    <Form.Dropdown id={id + "-type"} title="Action Type" value={type} onChange={setType}>
      {actionTypes.filter(({ value }) => complex || value === "key").map(({ value, title }) =>
        <Form.Dropdown.Item key={value} value={value} title={title} />)}
    </Form.Dropdown>
    {type === "shell" && <Form.TextArea id={id + "-command"} title="Shell Command"
      defaultValue={output.shell_command ?? ""} placeholder="/usr/bin/open -a Finder" />}
    {type === "app" && <>
      <Form.TextField id={id + "-app-path"} title="Application Path" defaultValue={app?.file_path ?? ""}
        placeholder="/Applications/Example.app" />
      <Form.TextField id={id + "-bundle"} title="Bundle ID" defaultValue={app?.bundle_identifier ?? ""}
        placeholder="Enter a path or bundle ID" />
    </>}
    {type === "key" && <>
      <Form.Dropdown id={id + "-key"} title="Output Key" defaultValue={key ? key.type + ":" + key.code : "key_code:a"}>
        {keyTypes.map((keyType) => {
          const codes = new Set(keys[keyType as keyof typeof keys]);
          if (key?.type === keyType) codes.add(key.code);
          return codes.size > 0 && <Form.Dropdown.Section key={keyType} title={keyLabel(keyType)}>
            {[...codes].map((code) => <Form.Dropdown.Item key={code} value={keyType + ":" + code} title={keyLabel(code)} />)}
          </Form.Dropdown.Section>;
        })}
      </Form.Dropdown>
      {complex && <Form.TagPicker id={id + "-mods"} title="Output Modifiers" defaultValue={output.modifiers ?? []}>
        {[...new Set([...modifiers, ...(output.modifiers ?? [])])].map((name) =>
          <Form.TagPicker.Item key={name} value={name} title={keyLabel(name)} />)}
      </Form.TagPicker>}
    </>}
  </>;
}

type FormValues = { key: string; name?: string; mandatory?: string[] } & Record<string, string | string[] | undefined>;

function readOutput(values: FormValues, id: string, original: Output): Output {
  const kind = values[id + "-type"];
  if (!kind) return original;
  const result: Output = kind === outputType(original) ? { ...original } : {};
  if (kind === "shell") {
    const command = String(values[id + "-command"] ?? "");
    if (!command.trim()) throw new Error("Enter a shell command.");
    result.shell_command = command;
  } else if (kind === "app") {
    const filePath = String(values[id + "-app-path"] ?? "").trim();
    const bundle = String(values[id + "-bundle"] ?? "").trim();
    if (!filePath && !bundle) throw new Error("Enter an application path or bundle ID.");
    result.software_function = { ...result.software_function, open_application: {
      ...(filePath ? { file_path: filePath } : {}),
      ...(bundle ? { bundle_identifier: bundle } : {}),
    } };
  } else {
    const [type, code] = String(values[id + "-key"] ?? "").split(":");
    if (!keyTypes.includes(type) || !code) throw new Error("Select an output key.");
    const previous = keyOf(result);
    if (previous) delete result[previous.type];
    result[type] = code;
    const mods = values[id + "-mods"];
    if (Array.isArray(mods) && mods.length) result.modifiers = mods;
    else delete result.modifiers;
  }
  return result;
}

function Editor({ snapshot, index, profile, reload }: { snapshot: Snapshot; index?: number; profile: string; reload: () => void }) {
  const { pop } = useNavigation();
  const adding = index === undefined;
  const binding: Pick<Binding, "group" | "complex" | "mapping"> = adding
    ? { group: "Add Keybinding", complex: true, mapping: { from: { key_code: "a" }, to: [{ key_code: "b" }] } }
    : snapshot.bindings[index];
  const original = keyOf(binding.mapping.from);
  const [saving, setSaving] = useState(false);
  const options = keyTypes.flatMap((type) => {
    const installed = snapshot.bindings.map(({ mapping }) => keyOf(mapping.from))
      .filter((key) => key?.type === type).map((key) => key!.code);
    return [...new Set([...keys[type as keyof typeof keys], ...installed])].map((code) => ({
      type, code, value: type + ":" + code,
    }));
  }).filter(({ type }) => binding.complex || type === original?.type);

  async function submit(values: FormValues) {
    const selected = options.find(({ value }) => value === values.key);
    if (!selected || saving) return;
    setSaving(true);
    try {
      const outputs: Outputs = {};
      for (const phase of outputPhases) {
        const sequence = binding.mapping[phase];
        if (sequence) outputs[phase] = sequence.map((output, step) => readOutput(values, phase + step, output));
      }
      if (adding) addBinding(snapshot, profile, values.name ?? "", selected.type, selected.code, values.mandatory ?? [], outputs);
      else commitShortcut(snapshot, index, selected.type, selected.code, values.mandatory ?? [], outputs);
      reload();
      pop();
      await restartKarabinerAfterSave("Keybinding Saved");
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: "Could Not Save Keybinding", message: message(error) });
    } finally {
      setSaving(false);
    }
  }

  if (!original) return <Form navigationTitle={binding.group}>
    <Form.Description title="Action" text={actionLabel(binding.mapping)} />
    <Form.Description text="This input format cannot be edited." />
  </Form>;

  const mandatory = binding.mapping.from.modifiers?.mandatory ?? [];
  return <Form navigationTitle={binding.group} isLoading={saving} actions={
    <ActionPanel><Action.SubmitForm title="Save Keybinding" onSubmit={submit} /></ActionPanel>
  }>
    {adding ? <>
      <Form.Description title="Profile" text={profile} />
      <Form.TextField id="name" title="Name" placeholder="Open my workspace" autoFocus />
    </> : <>
      <Form.Description title="Action" text={actionLabel(binding.mapping)} />
      <Form.Description title="Current Shortcut" text={shortcut(binding.mapping.from)} />
    </>}
    <Form.Dropdown id="key" title="Input Key" defaultValue={original.type + ":" + original.code}>
      {keyTypes.map((type) => {
        const items = options.filter((option) => option.type === type);
        return items.length > 0 && <Form.Dropdown.Section key={type} title={keyLabel(type)}>
          {items.map(({ code, value }) => <Form.Dropdown.Item key={value} value={value} title={keyLabel(code)} />)}
        </Form.Dropdown.Section>;
      })}
    </Form.Dropdown>
    {binding.complex && <Form.TagPicker id="mandatory" title="Required Modifiers" defaultValue={mandatory}>
      {[...new Set([...modifiers, ...mandatory])].map((name) =>
        <Form.TagPicker.Item key={name} value={name} title={keyLabel(name)} />)}
    </Form.TagPicker>}
    {outputPhases.flatMap((phase) => (binding.mapping[phase] ?? []).map((output, step) => {
      const id = phase + step;
      const timing = phase === "to" ? "On Key Press" : "On Key Release";
      return <OutputFields key={id} id={id} output={output} complex={binding.complex} label={timing + " · Action " + (step + 1)} />;
    }))}
  </Form>;
}

export default function Command() {
  const path = configPath(getPreferenceValues<{ configPath?: string }>().configPath);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [profile, setProfile] = useState("");
  function reload() {
    try {
      const next = loadConfig(path);
      setSnapshot(next);
      setError("");
      setProfile((previous) => next.config.profiles?.some(({ name }) => name === previous)
        ? previous : next.activeProfile ?? next.config.profiles?.[0]?.name ?? "");
    } catch (error) {
      setSnapshot(undefined);
      setError(message(error));
    }
  }
  useEffect(reload, [path]);

  async function remove(index: number) {
    if (!snapshot) return;
    const { mapping } = snapshot.bindings[index];
    const confirmed = await confirmAlert({
      title: "Delete Keybinding?",
      message: shortcut(mapping.from) + " → " + actionLabel(mapping),
      primaryAction: { title: "Delete Keybinding", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      deleteBinding(snapshot, index);
      reload();
      await restartKarabinerAfterSave("Keybinding Deleted");
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: "Could Not Delete Keybinding", message: message(error) });
    }
  }

  const addAction = snapshot && profile && <Action.Push title="Add Keybinding" icon={Icon.Plus}
    target={<Editor snapshot={snapshot} profile={profile} reload={reload} />} />;
  const visible = snapshot?.bindings.map((binding, index) => ({ ...binding, index }))
    .filter((binding) => binding.profile === profile) ?? [];
  return <List searchBarPlaceholder="Search actions, keys, and applications" searchBarAccessory={
    snapshot && <List.Dropdown tooltip="Profile" value={profile} onChange={setProfile}>
      {snapshot.config.profiles?.map(({ name }) => <List.Dropdown.Item key={name} title={name} value={name} />)}
    </List.Dropdown>
  }>
    <List.EmptyView title={error ? "Could Not Open Karabiner Configuration" : "No Keybindings"} description={error || path}
      actions={<ActionPanel>{addAction}<Action title="Reload" onAction={reload} /></ActionPanel>} />
    {snapshot && [...new Set(visible.map(({ group }) => group))].map((group) =>
      <List.Section key={group} title={group}>
        {visible.filter((binding) => binding.group === group).map(({ mapping, index }) => {
          const apps = mapping.conditions?.flatMap((condition) => condition.bundle_identifiers ?? [])
            .map((app) => app.replaceAll("\\", "").replace(/^\^|\$$/g, "")) ?? [];
          const input = shortcut(mapping.from);
          const title = actionLabel(mapping);
          return <List.Item key={index} icon={Icon.Keyboard} title={title} subtitle={apps.join(", ")}
            accessories={[{ tag: input }]} keywords={[group, input, ...apps]}
            actions={<ActionPanel>
              <Action.Push title="Edit Keybinding" target={<Editor snapshot={snapshot} index={index} profile={profile} reload={reload} />} />
              {addAction}
              <Action title="Delete Keybinding" icon={Icon.Trash} style={Action.Style.Destructive} onAction={() => remove(index)} />
              <Action title="Reload" onAction={reload} />
            </ActionPanel>} />;
        })}
      </List.Section>
    )}
  </List>;
}
