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
import { logStatus } from "./utils/logger";
import { openEmojiModal } from "./utils/navigation";

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;
let unpatches: (() => void)[] = [];

function Settings() {
    useProxy(storage);

    return (
        <RN.ScrollView style={{ flex: 1, padding: 12 }}>
            <FormSection title="Actions">
                <FormRow label="Open Emoji Store" onPress={openEmojiModal} />
                <FormRow
                    label="Force Resync"
                    subLabel={`${storage.emojis?.length || 0} emojis cached`}
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
                    subLabel="Notify when bot is mentioned in responses"
                    value={storage.botPingToUserPing ?? true}
                    onValueChange={(val: boolean) => {
                        storage.botPingToUserPing = val;
                    }}
                />
            </FormSection>

            <FormSection title="Logs">
                {(storage.debugLogs || []).map((e: string, i: number) => (
                    <RN.Text key={i} style={{ color: "#aaa", fontSize: 11, marginVertical: 1 }}>
                        {e}
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

        logStatus("Initializing hooks and patches...");

        unpatches.push(patchAutocomplete());
        unpatches.push(patchMessages());
        unpatches.push(patchMessageActions());
        unpatches.push(patchChatBar());

        try {
            unpatches.push(
                registerCommand({
                    name: "emojistore",
                    displayName: "emojistore",
                    description: "Open Custom Emoji Store",
                    displayDescription: "Open Custom Emoji Store",
                    options: [],
                    execute: () => {
                        openEmojiModal();
                    },
                    applicationId: "-1",
                    inputType: 1,
                    type: 1,
                } as any)
            );
            logStatus("Registered /emojistore slash command");
        } catch (e) {
            logStatus(`Failed to register /emojistore: ${String(e)}`, true);
        }

        syncEmojisFromBot(false);
        preloadRemotePacks();
        logStatus("Plugin loaded successfully.");
    },

    onUnload() {
        for (const unpatch of unpatches) {
            try {
                if (typeof unpatch === "function") unpatch();
            } catch {}
        }
        unpatches = [];
        logStatus("Plugin unloaded.");
    },
};
