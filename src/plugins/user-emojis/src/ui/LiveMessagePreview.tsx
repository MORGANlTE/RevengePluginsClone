import { findByStoreName } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { AppEmoji } from "../types";
import { getEmojiCdnUrl, SelectedChannelStore } from "../utils/botApi";
import { DraftStore } from "../utils/draft";

const UserStore = findByStoreName("UserStore");

interface Token {
    type: "text" | "emoji";
    content: string;
    emoji?: AppEmoji;
}

export default function LiveMessagePreview({ inputProps }: { inputProps?: any }) {
    const [text, setText] = React.useState<string>(() => {
        try {
            const channelId = SelectedChannelStore?.getChannelId();
            return DraftStore?.getDraft ? DraftStore.getDraft(channelId, 0) || "" : "";
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
                if (typeof initial === "string") setText(initial);
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

    const tokens = React.useMemo<Token[]>(() => {
        if (!text) return [];
        const loaded: AppEmoji[] = storage.emojis || [];
        if (!loaded.length) return [{ type: "text", content: text }];

        const emojiMap = new Map<string, AppEmoji>(loaded.map((e: AppEmoji) => [e.name.toLowerCase(), e]));
        const result: Token[] = [];

        // Single pass regex for <a:name:id>, :name:, ;name;
        const regex = /(<a?:([A-Za-z0-9_]+):(\d+)>)|:([A-Za-z0-9_]+):|;([A-Za-z0-9_]+);/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                result.push({
                    type: "text",
                    content: text.substring(lastIndex, match.index),
                });
            }

            const name = (match[2] || match[4] || match[5] || "").toLowerCase();
            const id = match[3];
            const found = emojiMap.get(name) || (id ? loaded.find((e) => e.id === id) : undefined);

            if (found) {
                result.push({
                    type: "emoji",
                    content: match[0],
                    emoji: found,
                });
            } else {
                result.push({
                    type: "text",
                    content: match[0],
                });
            }

            lastIndex = regex.lastIndex;
        }

        if (lastIndex < text.length) {
            result.push({
                type: "text",
                content: text.substring(lastIndex),
            });
        }

        return result;
    }, [text]);

    const hasEmojis = React.useMemo(() => {
        return tokens.some((t) => t.type === "emoji");
    }, [tokens]);

    // Check if message is emoji-only (Jumboji)
    const isEmojiOnly = React.useMemo(() => {
        const nonEmojiText = tokens
            .filter((t) => t.type === "text")
            .map((t) => t.content.trim())
            .join("");
        const emojiCount = tokens.filter((t) => t.type === "emoji").length;
        return nonEmojiText.length === 0 && emojiCount > 0 && emojiCount <= 8;
    }, [tokens]);

    // Dynamic sizing: 48px for 1 emoji, 40px for 2-3 emojis, 22px for inline with text
    const emojiSize = React.useMemo(() => {
        if (!isEmojiOnly) return 22;
        const emojiCount = tokens.filter((t) => t.type === "emoji").length;
        if (emojiCount === 1) return 48;
        if (emojiCount <= 3) return 40;
        return 32;
    }, [isEmojiOnly, tokens]);

    if (!hasEmojis || !text.trim()) return null;

    const author = UserStore?.getCurrentUser?.();
    const avatarUrl = author?.getAvatarURL ? author.getAvatarURL() : "https://cdn.discordapp.com/embed/avatars/0.png";
    const authorName = author?.globalName || author?.username || "You";

    return (
        <RN.View
            style={{
                backgroundColor: "rgba(20, 21, 24, 0.95)",
                borderRadius: 12,
                marginHorizontal: 8,
                marginBottom: 6,
                padding: 10,
                borderWidth: 1,
                borderColor: "rgba(88, 101, 242, 0.45)",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 4,
            }}
        >
            {/* Header */}
            <RN.View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingBottom: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: "rgba(255, 255, 255, 0.08)",
                    marginBottom: 8,
                }}
            >
                <RN.Text style={{ color: "#5865F2", fontSize: 11, fontWeight: "bold" }}>
                    ✨ Message preview
                </RN.Text>
            </RN.View>

            {/* Message Body */}
            <RN.View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <RN.Image
                    source={{ uri: avatarUrl }}
                    style={{ width: 34, height: 34, borderRadius: 17 }}
                />

                <RN.View style={{ flex: 1 }}>
                    <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <RN.Text style={{ color: "#ffffff", fontSize: 13, fontWeight: "bold" }}>
                            {authorName}
                        </RN.Text>
                        <RN.Text style={{ color: "#777", fontSize: 10 }}>
                            Today at {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </RN.Text>
                    </RN.View>

                    <RN.View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                        {tokens.map((token, index) => {
                            if (token.type === "emoji" && token.emoji) {
                                return (
                                    <RN.Image
                                        key={`prev-emoji-${token.emoji.id}-${index}`}
                                        source={{
                                            uri: getEmojiCdnUrl(token.emoji.id, Boolean(token.emoji.animated)),
                                        }}
                                        style={{
                                            width: emojiSize,
                                            height: emojiSize,
                                            marginHorizontal: isEmojiOnly ? 4 : 2,
                                            marginVertical: isEmojiOnly ? 2 : 0,
                                        }}
                                        resizeMode="contain"
                                    />
                                );
                            }
                            return (
                                <RN.Text
                                    key={`prev-txt-${index}`}
                                    style={{ color: "#dbdee1", fontSize: 14 }}
                                >
                                    {token.content}
                                </RN.Text>
                            );
                        })}
                    </RN.View>
                </RN.View>
            </RN.View>
        </RN.View>
    );
}
