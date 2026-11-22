import { Action, ActionPanel, Form, Icon, List, Toast, getPreferenceValues, showToast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { actionLabel, commitShortcut, configPath, keyLabel, keyOf, keys, keyTypes, loadConfig, modifiers, shortcut, outputPhases, type Output, type Outputs, type Snapshot } from "./config";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

const actionTypes = [
  { value: "key", title: "キー入力" },
  { value: "shell", title: "シェルコマンド" },
  { value: "app", title: "アプリを開く" },
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
    <Form.Dropdown id={id + "-type"} title="動作の種類" value={type} onChange={setType}>
      {actionTypes.filter(({ value }) => complex || value === "key").map(({ value, title }) =>
        <Form.Dropdown.Item key={value} value={value} title={title} />)}
    </Form.Dropdown>
    {type === "shell" && <Form.TextArea id={id + "-command"} title="シェルコマンド"
      defaultValue={output.shell_command ?? ""} placeholder="/usr/bin/open -a Finder" />}
    {type === "app" && <>
      <Form.TextField id={id + "-app-path"} title="アプリのパス" defaultValue={app?.file_path ?? ""}
        placeholder="/Applications/Example.app" />
      <Form.TextField id={id + "-bundle"} title="バンドル ID" defaultValue={app?.bundle_identifier ?? ""}
        placeholder="パスかバンドル ID を入力" />
    </>}
    {type === "key" && <>
      <Form.Dropdown id={id + "-key"} title="出力キー" defaultValue={key ? key.type + ":" + key.code : "key_code:a"}>
        {keyTypes.map((keyType) => {
          const codes = new Set(keys[keyType as keyof typeof keys]);
          if (key?.type === keyType) codes.add(key.code);
          return codes.size > 0 && <Form.Dropdown.Section key={keyType} title={keyLabel(keyType)}>
            {[...codes].map((code) => <Form.Dropdown.Item key={code} value={keyType + ":" + code} title={keyLabel(code)} />)}
          </Form.Dropdown.Section>;
        })}
      </Form.Dropdown>
      {complex && <Form.TagPicker id={id + "-mods"} title="出力の修飾キー" defaultValue={output.modifiers ?? []}>
        {[...new Set([...modifiers, ...(output.modifiers ?? [])])].map((name) =>
          <Form.TagPicker.Item key={name} value={name} title={keyLabel(name)} />)}
      </Form.TagPicker>}
    </>}
  </>;
}

type FormValues = { key: string; mandatory?: string[] } & Record<string, string | string[] | undefined>;

function readOutput(values: FormValues, id: string, original: Output): Output {
  const kind = values[id + "-type"];
  if (!kind) return original;
  const result: Output = kind === outputType(original) ? { ...original } : {};
  if (kind === "shell") {
    const command = String(values[id + "-command"] ?? "");
    if (!command.trim()) throw new Error("シェルコマンドを入力してください。");
    result.shell_command = command;
  } else if (kind === "app") {
    const filePath = String(values[id + "-app-path"] ?? "").trim();
    const bundle = String(values[id + "-bundle"] ?? "").trim();
    if (!filePath && !bundle) throw new Error("アプリのパスかバンドル ID を入力してください。");
    result.software_function = { ...result.software_function, open_application: {
      ...(filePath ? { file_path: filePath } : {}),
      ...(bundle ? { bundle_identifier: bundle } : {}),
    } };
  } else {
    const [type, code] = String(values[id + "-key"] ?? "").split(":");
    if (!keyTypes.includes(type) || !code) throw new Error("出力キーを選んでください。");
    const previous = keyOf(result);
    if (previous) delete result[previous.type];
    result[type] = code;
    const mods = values[id + "-mods"];
    if (Array.isArray(mods) && mods.length) result.modifiers = mods;
    else delete result.modifiers;
  }
  return result;
}

function Editor({ snapshot, index, reload }: { snapshot: Snapshot; index: number; reload: () => void }) {
  const { pop } = useNavigation();
  const binding = snapshot.bindings[index];
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
      commitShortcut(snapshot, index, selected.type, selected.code, values.mandatory ?? [], outputs);
      reload();
      pop();
      await showToast({ style: Toast.Style.Success, title: "キー割り当てを保存しました" });
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: "保存できませんでした", message: message(error) });
    } finally {
      setSaving(false);
    }
  }

  if (!original) return <Form navigationTitle={binding.group}>
    <Form.Description title="動作" text={actionLabel(binding.mapping)} />
    <Form.Description text="この形式の入力は編集できません。" />
  </Form>;

  const mandatory = binding.mapping.from.modifiers?.mandatory ?? [];
  return <Form navigationTitle={binding.group} isLoading={saving} actions={
    <ActionPanel><Action.SubmitForm title="キー割り当てを保存" onSubmit={submit} /></ActionPanel>
  }>
    <Form.Description title="動作" text={actionLabel(binding.mapping)} />
    <Form.Description title="現在の割り当て" text={shortcut(binding.mapping.from)} />
    <Form.Dropdown id="key" title="入力キー" defaultValue={original.type + ":" + original.code}>
      {keyTypes.map((type) => {
        const items = options.filter((option) => option.type === type);
        return items.length > 0 && <Form.Dropdown.Section key={type} title={keyLabel(type)}>
          {items.map(({ code, value }) => <Form.Dropdown.Item key={value} value={value} title={keyLabel(code)} />)}
        </Form.Dropdown.Section>;
      })}
    </Form.Dropdown>
    {binding.complex && <Form.TagPicker id="mandatory" title="必須の修飾キー" defaultValue={mandatory}>
      {[...new Set([...modifiers, ...mandatory])].map((name) =>
        <Form.TagPicker.Item key={name} value={name} title={keyLabel(name)} />)}
    </Form.TagPicker>}
    {outputPhases.flatMap((phase) => (binding.mapping[phase] ?? []).map((output, step) => {
      const id = phase + step;
      const timing = phase === "to" ? "キーを押したとき" : "キーを離したとき";
      return <OutputFields key={id} id={id} output={output} complex={binding.complex} label={timing + " · 動作 " + (step + 1)} />;
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

  const visible = snapshot?.bindings.map((binding, index) => ({ ...binding, index }))
    .filter((binding) => binding.profile === profile) ?? [];
  return <List searchBarPlaceholder="動作、キー、対象アプリを検索" searchBarAccessory={
    snapshot && <List.Dropdown tooltip="プロファイル" value={profile} onChange={setProfile}>
      {snapshot.config.profiles?.map(({ name }) => <List.Dropdown.Item key={name} title={name} value={name} />)}
    </List.Dropdown>
  }>
    <List.EmptyView title={error ? "Karabiner の設定を開けません" : "割り当てがありません"} description={error || path}
      actions={<ActionPanel><Action title="再読み込み" onAction={reload} /></ActionPanel>} />
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
              <Action.Push title="割り当てを編集" target={<Editor snapshot={snapshot} index={index} reload={reload} />} />
              <Action title="再読み込み" onAction={reload} />
            </ActionPanel>} />;
        })}
      </List.Section>
    )}
  </List>;
}
