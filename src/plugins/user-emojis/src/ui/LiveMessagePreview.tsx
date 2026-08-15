import { findByName, findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { AppEmoji } from "../types";
import { SelectedChannelStore } from "../utils/botApi";
import { DraftStore } from "../utils/draft";

const ChatItemWrapper =
    findByProps("DCDAutoModerationSystemMessageView", "default")?.default ||
    findByName("ChatItemWrapper");
const MessageRecord = findByName("MessageRecord");
const RowManager = findByName("RowManager");
const UserStore = findByStoreName("UserStore");

export default function LiveMessagePreview({ inputProps }: { inputProps?: any }) {
    const [rawText, setRawText] = React.useState<string>(() => {
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
                if (typeof initial === "string") setRawText(initial);
            } catch {}
        }

        if (typeof target.handleTextChanged === "function") {
            const unp = before("handleTextChanged", target, ([newText]) => {
                if (typeof newText === "string") {
                    setRawText(newText);
                }
            });
            return () => void unp();
        }
    }, [inputProps]);

    // Parse content to replace :name: and ;name; with full tags <a:name:id> for Discord's native renderer
    const parsedContent = React.useMemo(() => {
        if (!rawText || typeof rawText !== "string") return "";
        const loaded: AppEmoji[] = storage.emojis || [];
        if (!loaded.length) return rawText;

        const emojiMap = new Map<string, AppEmoji>(loaded.map((e: AppEmoji) => [e.name.toLowerCase(), e]));

        return rawText.replace(
            /(<a?:[A-Za-z0-9_]+:\d+>)|;([A-Za-z0-9_]+);|:([A-Za-z0-9_]+):/g,
            (match, fullTag, semiName, colonName) => {
                if (fullTag) return fullTag;
                const name = (semiName || colonName || "").toLowerCase();
                const found = emojiMap.get(name);
                if (found) {
                    return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
                }
                return match;
            }
        );
    }, [rawText]);

    const hasCustomEmojis = React.useMemo(() => {
        if (!parsedContent) return false;
        return /<a?:[A-Za-z0-9_]+:\d+>/.test(parsedContent);
    }, [parsedContent]);

    if (!hasCustomEmojis || !parsedContent.trim()) return null;

    const channelId = SelectedChannelStore?.getChannelId();
    const author = UserStore?.getCurrentUser?.();

    if (!ChatItemWrapper || !MessageRecord || !RowManager || !author) {
        return null;
    }

    let messageObj: any = null;
    try {
        messageObj = new MessageRecord({
            id: "preview-temp-0",
            channel_id: channelId,
            content: parsedContent,
            author,
            attachments: [],
        });
    } catch {
        return null;
    }

    return (
        <RN.View
            style={{
                backgroundColor: "rgba(0, 0, 0, 0.55)",
                borderRadius: 10,
                marginHorizontal: 8,
                marginBottom: 6,
                padding: 6,
                borderWidth: 1,
                borderColor: "rgba(88, 101, 242, 0.4)",
                overflow: "hidden",
            }}
        >
            <RN.View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingBottom: 4,
                    borderBottomWidth: 1,
                    borderBottomColor: "rgba(255, 255, 255, 0.08)",
                    marginBottom: 4,
                }}
            >
                <RN.Text style={{ color: "#5865F2", fontSize: 11, fontWeight: "bold" }}>
                    ✨ Message Preview (How it looks when sent)
                </RN.Text>
            </RN.View>

            <RN.ScrollView
                style={{ maxHeight: 90 }}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={false}
            >
                <ChatItemWrapper
                    rowGenerator={new RowManager()}
                    message={messageObj}
                />
            </RN.ScrollView>
        </RN.View>
    );
}
