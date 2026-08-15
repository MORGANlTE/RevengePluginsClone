import { React, ReactNative as RN } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { AppEmoji } from "../types";
import { getEmojiCdnUrl, SelectedChannelStore } from "../utils/botApi";
import { DraftStore } from "../utils/draft";

export default function EmojiPreviewBar({ inputProps }: { inputProps?: any }) {
    const [draftText, setDraftText] = React.useState<string>(() => {
        const channelId = SelectedChannelStore?.getChannelId();
        return (DraftStore?.getDraft ? DraftStore.getDraft(channelId, 0) || "" : "");
    });

    React.useEffect(() => {
        const target = inputProps?.current || inputProps;
        if (!target || typeof target.handleTextChanged !== "function") return;

        const unp = before("handleTextChanged", target, ([text]) => {
            if (typeof text === "string") {
                setDraftText(text);
            }
        });

        return () => void unp();
    }, [inputProps]);

    const activeEmojis = React.useMemo(() => {
        if (!draftText) return [];
        const list: AppEmoji[] = storage.emojis || [];
        if (!list.length) return [];

        const emojiMap = new Map<string, AppEmoji>(list.map((e: AppEmoji) => [e.name.toLowerCase(), e]));
        const foundList: AppEmoji[] = [];
        const seenIds = new Set<string>();

        // 1. Full Discord Tags <a:name:id>
        const tagMatches = Array.from(draftText.matchAll(/<a?:([A-Za-z0-9_]+):(\d+)>/g));
        for (const m of tagMatches) {
            const name = m[1].toLowerCase();
            const id = m[2];
            const found = emojiMap.get(name) || list.find((e) => e.id === id);
            if (found && !seenIds.has(found.id)) {
                seenIds.add(found.id);
                foundList.push(found);
            }
        }

        // 2. Colon :name: & Semicolon ;name;
        const shortMatches = Array.from(draftText.matchAll(/(?::([A-Za-z0-9_]+):|;([A-Za-z0-9_]+);)/g));
        for (const m of shortMatches) {
            const name = (m[1] || m[2] || "").toLowerCase();
            const found = emojiMap.get(name);
            if (found && !seenIds.has(found.id)) {
                seenIds.add(found.id);
                foundList.push(found);
            }
        }

        return foundList;
    }, [draftText]);

    if (activeEmojis.length === 0) return null;

    return (
        <RN.View
            style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "rgba(0, 0, 0, 0.45)",
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 8,
                marginHorizontal: 8,
                marginBottom: 4,
                gap: 6,
                borderWidth: 1,
                borderColor: "rgba(255, 255, 255, 0.08)",
            }}
        >
            <RN.Text style={{ color: "#aaa", fontSize: 10, fontWeight: "bold" }}>
                ✨ Emoji Preview:
            </RN.Text>
            <RN.ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ alignItems: "center", gap: 6 }}
            >
                {activeEmojis.map((emoji) => (
                    <RN.View
                        key={emoji.id}
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            backgroundColor: "rgba(255, 255, 255, 0.08)",
                            paddingHorizontal: 5,
                            paddingVertical: 2,
                            borderRadius: 6,
                            gap: 4,
                        }}
                    >
                        <RN.Image
                            source={{ uri: getEmojiCdnUrl(emoji.id, Boolean(emoji.animated)) }}
                            style={{ width: 18, height: 18 }}
                            resizeMode="contain"
                        />
                        <RN.Text style={{ color: "#fff", fontSize: 10, fontWeight: "600" }}>
                            :{emoji.name}:
                        </RN.Text>
                    </RN.View>
                ))}
            </RN.ScrollView>
        </RN.View>
    );
}
