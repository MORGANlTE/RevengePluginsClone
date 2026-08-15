import { React, ReactNative as RN } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { AppEmoji } from "../types";
import { getEmojiCdnUrl, SelectedChannelStore } from "../utils/botApi";
import { DraftStore } from "../utils/draft";

export default function ChatBarEmojiInline({ inputProps }: { inputProps?: any }) {
    const [text, setText] = React.useState<string>(() => {
        try {
            const channelId = SelectedChannelStore?.getChannelId();
            return (DraftStore?.getDraft ? DraftStore.getDraft(channelId, 0) || "" : "");
        } catch {
            return "";
        }
    });

    React.useEffect(() => {
        const target = inputProps?.current || inputProps;
        if (!target) return;

        if (typeof target.getText === "function") {
            try {
                const initial = target.getText();
                if (typeof initial === "string" && initial) setText(initial);
            } catch {}
        }

        if (typeof target.handleTextChanged === "function") {
            const unp = before("handleTextChanged", target, ([newText]) => {
                if (typeof newText === "string") {
                    setText(newText);
                }
            });
            return () => void unp();
        }
    }, [inputProps]);

    const activeEmojiImages = React.useMemo(() => {
        if (!text) return [];
        const loaded: AppEmoji[] = storage.emojis || [];
        if (!loaded.length) return [];

        const emojiMap = new Map<string, AppEmoji>(loaded.map((e: AppEmoji) => [e.name.toLowerCase(), e]));
        const resultList: { key: string; emoji: AppEmoji }[] = [];

        // 1. Tag matches: <a:name:id> or <:name:id>
        const tagMatches = Array.from(text.matchAll(/<a?:([A-Za-z0-9_]+):(\d+)>/g));
        for (let i = 0; i < tagMatches.length; i++) {
            const m = tagMatches[i];
            const name = m[1].toLowerCase();
            const id = m[2];
            const found = emojiMap.get(name) || loaded.find((e) => e.id === id);
            if (found) {
                resultList.push({ key: `tag-${found.id}-${i}`, emoji: found });
            }
        }

        // 2. Colon / Semicolon matches: :name: or ;name;
        const nameMatches = Array.from(text.matchAll(/(?::([A-Za-z0-9_]+):|;([A-Za-z0-9_]+);)/g));
        for (let i = 0; i < nameMatches.length; i++) {
            const m = nameMatches[i];
            const name = (m[1] || m[2] || "").toLowerCase();
            const found = emojiMap.get(name);
            if (found) {
                resultList.push({ key: `name-${found.id}-${i}`, emoji: found });
            }
        }

        return resultList;
    }, [text]);

    if (activeEmojiImages.length === 0) return null;

    return (
        <RN.View
            style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 3,
                marginHorizontal: 4,
                marginTop: 2,
                marginBottom: 2,
                backgroundColor: "rgba(0, 0, 0, 0.4)",
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "rgba(88, 101, 242, 0.3)",
            }}
        >
            {activeEmojiImages.map(({ key, emoji }) => (
                <RN.View
                    key={key}
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: "rgba(255, 255, 255, 0.1)",
                        borderRadius: 6,
                        paddingHorizontal: 4,
                        paddingVertical: 2,
                        gap: 3,
                    }}
                >
                    <RN.Image
                        source={{ uri: getEmojiCdnUrl(emoji.id, Boolean(emoji.animated)) }}
                        style={{ width: 22, height: 22 }}
                        resizeMode="contain"
                    />
                    <RN.Text style={{ color: "#fff", fontSize: 10, fontWeight: "600" }}>
                        :{emoji.name}:
                    </RN.Text>
                </RN.View>
            ))}
        </RN.View>
    );
}
