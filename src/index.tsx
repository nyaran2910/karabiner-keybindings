import { Action, ActionPanel, Form, Icon, List, Toast, getPreferenceValues, showToast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { actionLabel, commitShortcut, configPath, keyLabel, keyOf, keys, keyTypes, loadConfig, modifiers, shortcut, type Snapshot } from "./config";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

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

  async function submit(values: { key: string; mandatory?: string[] }) {
    const selected = options.find(({ value }) => value === values.key);
    if (!selected || saving) return;
    setSaving(true);
    try {
      commitShortcut(snapshot, index, selected.type, selected.code, values.mandatory ?? []);
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
