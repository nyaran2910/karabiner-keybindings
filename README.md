# Karabiner Keybindings for Raycast

Search, add, edit, and delete Karabiner-Elements keybindings from Raycast.

## Getting Started

1. With Raycast, Karabiner-Elements, and Node.js installed on macOS, run `npm ci` and `npm run dev` in this repository.
2. Open **Edit Karabiner Keybindings** in Raycast and choose a profile.
3. Search by action, key, or application. Select a result to edit it, or open the action menu to choose **Add Keybinding** or **Delete Keybinding**.
4. Choose the input key and modifiers. For complex modifications, choose **Send Keystroke**, **Shell Command**, or **Open Application**. Enter shell commands directly in the editor. Karabiner runs the command when you use the assigned keybinding.

New keybindings are added as complex modifications to the selected profile. You can edit each step of an existing multi-step action and actions that run on key release. Simple modifications and function-key mappings support keystroke outputs.

## Configuration

The extension reads `~/.config/karabiner/karabiner.json` by default. To edit a different file, set **Configuration File Path** in Raycast's extension settings. If you edit a separate dotfiles copy, use your usual sync workflow to apply it.

Every change saves the previous configuration as `karabiner.json.raycast-backup` in the same directory. Karabiner automatically reloads changes to the file it monitors. If another application updates the configuration while you are editing, reload the list and try again.
