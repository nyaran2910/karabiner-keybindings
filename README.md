# Karabiner Keybindings for Raycast

Raycast で Karabiner-Elements の既存の割り当てを検索し、動作を選んでショートカットと実行する動作を変更できます。

## 使い方

1. macOS に Raycast、Karabiner-Elements、Node.js を用意し、このリポジトリで `npm ci` と `npm run dev` を実行します。
2. Raycast で **Edit Karabiner Keybindings** を開きます。
3. 動作名・現在のキー・対象アプリで検索し、変更したい割り当てを選びます。
4. 入力キーや修飾キーを選び、実行する動作を編集して保存します。複雑な割り当てでは「キー入力」「シェルコマンド」「アプリを開く」を選べます。
5. 「シェルコマンド」を選んだ場合は、フォームにコマンドを入力します。コマンドは割り当てたキーの操作時に Karabiner が実行します。

複数の出力がある場合は、現在の実行順序で各動作を編集できます。単純な割り当てとファンクションキーの出力はキー入力として編集できます。

設定は通常 `~/.config/karabiner/karabiner.json` を読み込みます。別の場所にある構成を編集する場合は、Raycast の拡張設定で「設定ファイルのパス」を指定してください。dotfiles 内の別コピーを指定した場合は、普段の同期手順で反映してください。

保存時に直前の設定を同じディレクトリの `karabiner.json.raycast-backup` に残します。Karabiner が監視している設定ファイルへの変更は自動で反映されます。他のアプリで設定が更新された場合は、Raycast の一覧を再読み込みしてから編集してください。
