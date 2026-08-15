import { React, ReactNative as RN } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";
import { syncEmojisFromBot } from "./index";
import { EmojiStoreModal } from "./storeModal";
import { findByProps } from "@vendetta/metro";

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;
const LazyActionSheet = findByProps("openLazy");

export default function Settings() {
    useProxy(storage);

    return (
        <RN.ScrollView style={{ flex: 1, padding: 12 }}>
            <FormSection title="Custom Emoji Store">
                <FormRow
                    label="Open Emoji Store Picker"
                    subLabel="Browse custom emojis and community packs"
                    onPress={() => {
                        if (LazyActionSheet?.openLazy) {
                            LazyActionSheet.openLazy(
                                async () => () => <EmojiStoreModal />,
                                "CustomEmojiStoreSheet"
                            );
                        }
                    }}
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
                <FormInput
                    title="Pack Index URL"
                    value={storage.packIndexUrl || ""}
                    placeholder="https://raw.githubusercontent.com/.../packs_index.json"
                    onChange={(val: string) => {
                        storage.packIndexUrl = val.trim();
                    }}
                />
                <FormSwitchRow
                    label="Bot Ping -> User Ping"
                    subLabel="Triggers a notification ping if your proxy bot is mentioned"
                    value={storage.botPingToUserPing ?? true}
                    onValueChange={(val: boolean) => {
                        storage.botPingToUserPing = val;
                    }}
                />
            </FormSection>

            <FormSection title="Management">
                <FormRow
                    label="Force Resync"
                    subLabel={`Cached Emojis: ${storage.emojis?.length || 0}`}
                    onPress={() => syncEmojisFromBot(true)}
                />
            </FormSection>
        </RN.ScrollView>
    );
}
