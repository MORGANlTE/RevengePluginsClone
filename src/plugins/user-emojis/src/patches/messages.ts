import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { before, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { AppEmoji } from "../types";
import {
    AuthenticationStore,
    getActiveApp,
    RestAPI,
    SelectedGuildStore,
} from "../utils/botApi";
import { DraftActions, transformDraftText } from "../utils/draft";
import { logStatus } from "../utils/logger";

function encodeMessageContent(content: string, emojis: AppEmoji[]): { text: string; shouldProxy: boolean } {
    if (!content || !emojis.length) return { text: content, shouldProxy: false };
    const emojiMap = new Map(emojis.map((e) => [e.name.toLowerCase(), e]));
    let shouldProxy = false;

    // Correct 5 capture groups: 1=fullTag, 2=tagEmojiName, 3=tagEmojiId, 4=semiName, 5=colonName
    const result = content.replace(
        /(<a?:([A-Za-z0-9_]+):(\d+)>)|;([A-Za-z0-9_]+);|:([A-Za-z0-9_]+):/g,
        (match, fullTag, tagEmojiName, tagEmojiId, semiName, colonName) => {
            const name = (tagEmojiName || semiName || colonName || "").toLowerCase();
            const found = emojiMap.get(name) || (tagEmojiId ? emojis.find((e) => e.id === tagEmojiId) : undefined);
            if (found) {
                shouldProxy = true;
                return `;${found.name};`;
            }
            return match;
        }
    );

    return { text: result, shouldProxy };
}

export function patchMessages(): () => void {
    const unpatches: (() => void)[] = [];

    const MessageActions = findByProps("sendMessage", "editMessage");
    const RowManager = findByProps("createRowFromMessage", "generateRows");
    const UserStore = findByStoreName("UserStore");

    // 1. Live Chat Draft Preview Replacement
    if (DraftActions) {
        if (typeof DraftActions.saveDraft === "function") {
            unpatches.push(
                instead("saveDraft", DraftActions, (args, orig) => {
                    if (typeof args[1] === "string") args[1] = transformDraftText(args[1]);
                    return orig.apply(DraftActions, args);
                })
            );
        }
        if (typeof DraftActions.setDraft === "function") {
            unpatches.push(
                instead("setDraft", DraftActions, (args, orig) => {
                    if (typeof args[1] === "string") args[1] = transformDraftText(args[1]);
                    return orig.apply(DraftActions, args);
                })
            );
        }
        logStatus("Patched DraftActions for live chatbar emoji previews");
    }

    // 2. Incoming/Local Message AST Compilation Parser
    if (RowManager?.createRowFromMessage) {
        unpatches.push(
            before("createRowFromMessage", RowManager, (args) => {
                const [row] = args;
                const loaded: AppEmoji[] = storage.emojis || [];
                if (row?.message?.content && loaded.length > 0) {
                    const emojiMap = new Map(loaded.map((e) => [e.name.toLowerCase(), e]));
                    row.message.content = row.message.content.replace(
                        /(<a?:([A-Za-z0-9_]+):(\d+)>)|;([A-Za-z0-9_]+);|:([A-Za-z0-9_]+):/g,
                        (match: string, fullTag: string, tagEmojiName: string, tagEmojiId: string, semi: string, colon: string) => {
                            if (fullTag) return fullTag;
                            const name = (tagEmojiName || semi || colon || "").toLowerCase();
                            const found = emojiMap.get(name) || (tagEmojiId ? loaded.find((e) => e.id === tagEmojiId) : undefined);
                            if (found) {
                                return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
                            }
                            return match;
                        }
                    );
                }
            })
        );
        logStatus("Patched RowManager.createRowFromMessage for chat bubble parsing");
    }

    // 3. Outgoing Message Proxying (/e interaction dispatch)
    if (MessageActions) {
        unpatches.push(
            instead("sendMessage", MessageActions, async (args, orig) => {
                const [channelId, message] = args;
                const loaded: AppEmoji[] = storage.emojis || [];

                if (message?.content && loaded.length > 0) {
                    const { text, shouldProxy } = encodeMessageContent(message.content, loaded);

                    if (shouldProxy) {
                        const app = getActiveApp();
                        if (app?.commands.e) {
                            logStatus("Proxying emoji message via bot /e interaction...");
                            const guildId = SelectedGuildStore?.getGuildId() || undefined;
                            try {
                                await RestAPI.post({
                                    url: "/interactions",
                                    body: {
                                        type: 2,
                                        application_id: app.appId,
                                        guild_id: guildId,
                                        channel_id: channelId,
                                        session_id: AuthenticationStore.getSessionId(),
                                        data: {
                                            id: app.commands.e.id,
                                            version: app.commands.e.version,
                                            name: "e",
                                            type: 1,
                                            options: [{ type: 3, name: "text", value: text }],
                                        },
                                        nonce: Date.now().toString(),
                                    },
                                });
                                return;
                            } catch (e) {
                                logStatus(`SendMessage proxy error: ${String(e)}`, true);
                            }
                        }
                    }
                }
                return orig.apply(MessageActions, args);
            })
        );

        // 4. Outgoing Message Edit Proxying (/ed interaction dispatch)
        unpatches.push(
            instead("editMessage", MessageActions, async (args, orig) => {
                const [channelId, messageId, message] = args;
                const loaded: AppEmoji[] = storage.emojis || [];

                if (message?.content && loaded.length > 0) {
                    const { text, shouldProxy } = encodeMessageContent(message.content, loaded);

                    if (shouldProxy) {
                        const app = getActiveApp();
                        if (app?.commands.ed) {
                            logStatus("Proxying emoji edit via bot /ed interaction...");
                            const guildId = SelectedGuildStore?.getGuildId() || undefined;
                            try {
                                await RestAPI.post({
                                    url: "/interactions",
                                    body: {
                                        type: 2,
                                        application_id: app.appId,
                                        guild_id: guildId,
                                        channel_id: channelId,
                                        session_id: AuthenticationStore.getSessionId(),
                                        data: {
                                            id: app.commands.ed.id,
                                            version: app.commands.ed.version,
                                            name: "ed",
                                            type: 1,
                                            options: [
                                                { type: 3, name: "message_id", value: messageId },
                                                { type: 3, name: "text", value: text },
                                            ],
                                        },
                                        nonce: Date.now().toString(),
                                    },
                                });
                                return;
                            } catch (e) {
                                logStatus(`EditMessage proxy error: ${String(e)}`, true);
                            }
                        }
                    }
                }
                return orig.apply(MessageActions, args);
            })
        );
        logStatus("Patched MessageActions for outgoing emoji messages");
    }

    return () => unpatches.forEach((u) => u?.());
}
