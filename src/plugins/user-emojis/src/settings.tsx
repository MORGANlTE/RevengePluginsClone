import { React, ReactNative as RN } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";
import { syncEmojisFromBot } from "./index";

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;

export default function Settings() {
    useProxy(storage);

    return (
        <RN.ScrollView style={{ flex: 1, padding: 12 }}>
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
