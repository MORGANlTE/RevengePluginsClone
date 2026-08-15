import { React, ReactNative as RN } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { AppEmoji } from "../types";
import { getEmojiCdnUrl, SelectedChannelStore } from "../utils/botApi";
import { DraftStore } from "../utils/draft";

interface Token {
    type: "text" | "emoji";
    content: string;
    emoji?: AppEmoji;
}

export default function RichChatInput({ inputProps }: { inputProps?: any }) {
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

        // Regex for <a:name:id>, :name:, ;name;
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

    if (!hasEmojis) return null;

    return (
        <RN.View
            pointerEvents="none"
            style={{
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                paddingHorizontal: 12,
                paddingVertical: 6,
                marginHorizontal: 8,
                marginBottom: 4,
                backgroundColor: "rgba(0, 0, 0, 0.45)",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "rgba(88, 101, 242, 0.35)",
            }}
        >
            {tokens.map((token, index) => {
                if (token.type === "emoji" && token.emoji) {
                    return (
                        <RN.Image
                            key={`rich-emoji-${token.emoji.id}-${index}`}
                            source={{
                                uri: getEmojiCdnUrl(token.emoji.id, Boolean(token.emoji.animated)),
                            }}
                            style={{
                                width: 24,
                                height: 24,
                                marginHorizontal: 2,
                            }}
                            resizeMode="contain"
                        />
                    );
                }
                return (
                    <RN.Text
                        key={`rich-txt-${index}`}
                        style={{ color: "#ffffff", fontSize: 15 }}
                    >
                        {token.content}
                    </RN.Text>
                );
            })}
        </RN.View>
    );
}
