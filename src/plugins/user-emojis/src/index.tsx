import { registerCommand } from "@vendetta/commands";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { patchAutocomplete } from "./patches/autocomplete";
import { patchChatBar } from "./patches/chatBar";
import { patchMessageActions } from "./patches/messageActions";
import { patchMessages } from "./patches/messages";
import { syncEmojisFromBot } from "./utils/botApi";
import { logStatus, PLUGIN_TAG } from "./utils/logger";
import { openEmojiModal } from "./utils/navigation";

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;
let unpatchList: (() => void)[] = [];

function Settings() {
    useProxy(storage);

    return (
        <RN.ScrollView style={{ flex: 1, padding: 12 }}>
            <FormSection title="Actions">
                <FormRow
                    label="Open Emoji Store Picker"
                    subLabel="Browse custom emojis"
                    onPress={openEmojiModal}
                />
                <FormRow
                    label="Force Resync Emojis"
                    subLabel={`Cached Emojis: ${storage.emojis?.length || 0}`}
                    onPress={() => syncEmojisFromBot(true)}
                />
            </FormSection>

            <FormSection title="Configuration">
                <FormInput
                    title="User App ID"
                    value={storage.selectedAppId || ""}
                    placeholder="Enter Application ID"
                    onChange={(val: string) => {
                        storage.selectedAppId = val.trim();
                    }}
                />
                <FormSwitchRow
                    label="Bot Ping -> User Ping"
                    subLabel="Triggers notification when proxy bot is mentioned"
                    value={storage.botPingToUserPing ?? true}
                    onValueChange={(val: boolean) => {
                        storage.botPingToUserPing = val;
                    }}
                />
            </FormSection>

            <FormSection title="Live Diagnostic Logs">
                {(storage.debugLogs || []).map((entry: string, idx: number) => (
                    <RN.Text key={idx} style={{ color: "#aaa", fontSize: 11, marginVertical: 2 }}>
                        {entry}
                    </RN.Text>
                ))}
            </FormSection>
        </RN.ScrollView>
    );
}

export default {
    settings: Settings,
    onLoad() {
        if (!storage.emojis) storage.emojis = [];
        if (!storage.apps) storage.apps = [];
        if (!storage.debugLogs) storage.debugLogs = [];
        if (storage.botPingToUserPing === undefined) storage.botPingToUserPing = true;

        logStatus("Initializing plugin hooks...");

        // 1. Register patches
        unpatchList.push(patchAutocomplete());
        unpatchList.push(patchChatBar());
        unpatchList.push(patchMessageActions());
        unpatchList.push(patchMessages());

        // 2. Register Slash Command fallback
        try {
            unpatchList.push(
                registerCommand({
                    name: "emojistore",
                    displayName: "emojistore",
                    description: "Open User App Emoji picker",
                    displayDescription: "Open User App Emoji picker",
                    options: [],
                    execute: openEmojiModal,
                })
            );
            logStatus("Registered /emojistore slash command");
        } catch (e) {
            logStatus(`Failed to register slash command: ${String(e)}`, true);
        }

        // 3. Initial sync
        syncEmojisFromBot(false);
        logStatus("Plugin loaded successfully.");
    },

    onUnload() {
        for (const unpatch of unpatchList) {
            try {
                if (typeof unpatch === "function") unpatch();
            } catch {}
        }
        unpatchList = [];
        logStatus("Plugin unloaded and all patches cleaned up.");
    },
};
