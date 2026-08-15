import { registerCommand } from "@vendetta/commands";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { fetchPlugin, plugins, startPlugin, stopPlugin } from "@vendetta/plugins";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { patchAutocomplete } from "./patches/autocomplete";
import { patchChatBar } from "./patches/chatBar";
import { patchMessageActions } from "./patches/messageActions";
import { patchMessages } from "./patches/messages";
import { preloadRemotePacks, syncEmojisFromBot } from "./utils/botApi";
import { logStatus, PLUGIN_TAG } from "./utils/logger";
import { openEmojiStore } from "./utils/navigation";

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;
let unpatches: (() => void)[] = [];

async function hotReloadPlugin() {
    try {
        const pluginUrl = Object.keys(plugins).find(
            (k) => k.includes("user-emojis") || plugins[k]?.manifest?.name === "UserEmojiPicker"
        );
        if (pluginUrl) {
            showToast(`${PLUGIN_TAG} Refetching plugin...`, 1);
            logStatus(`Hot-reloading plugin from ${pluginUrl}`);
            stopPlugin(pluginUrl);
            await fetchPlugin(pluginUrl);
            startPlugin(pluginUrl);
            showToast(`${PLUGIN_TAG} Updated & reloaded!`, 1);
        } else {
            showToast(`${PLUGIN_TAG} Plugin URL not found in registry`, 2);
        }
    } catch (e) {
        logStatus(`Hot reload error: ${String(e)}`, true);
        showToast(`${PLUGIN_TAG} Update error: ${String(e)}`, 2);
    }
}

function Settings() {
    useProxy(storage);

    return (
        <RN.ScrollView style={{ flex: 1, padding: 12 }}>
            <FormSection title="Actions">
                <FormRow label="Open Emoji Store" onPress={openEmojiStore} />
                <FormRow
                    label="Force Resync"
                    subLabel={`${storage.emojis?.length || 0} emojis cached`}
                    onPress={() => syncEmojisFromBot(true)}
                />
                <FormRow
                    label="Check for Updates / Hot-Reload"
                    subLabel="Refetches the latest bundle and reloads live"
                    onPress={hotReloadPlugin}
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
                        openEmojiStore();
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
