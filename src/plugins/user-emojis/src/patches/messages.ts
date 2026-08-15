import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { before, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { AppEmoji } from "../types";
import {
    AuthenticationStore,
    emojiRegex,
    getActiveApp,
    RestAPI,
    SelectedGuildStore,
} from "../utils/botApi";
import { DraftActions, transformDraftText } from "../utils/draft";
import { logStatus } from "../utils/logger";

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
    } else {
        logStatus("DraftActions not found", true);
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
                        /(?<!<a?:[A-Za-z0-9_]+:\d+)(?:;([A-Za-z0-9_]+);|:([A-Za-z0-9_]+):)/g,
                        (match: string, semi: string, colon: string) => {
                            const name = (semi || colon || "").toLowerCase();
                            const found = emojiMap.get(name);
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
    } else {
        logStatus("RowManager not found", true);
    }

    // 3. Outgoing Message Proxying (/e interaction dispatch)
    if (MessageActions) {
        unpatches.push(
            instead("sendMessage", MessageActions, async (args, orig) => {
                const [channelId, message] = args;
                const loaded: AppEmoji[] = storage.emojis || [];

                if (message?.content && loaded.length > 0) {
                    let replaced = false;
                    const emojiMap = new Map(loaded.map((e) => [e.name.toLowerCase(), e]));

                    const transformed = String(message.content).replace(emojiRegex, (match, tag) => {
                        const found = emojiMap.get(tag.toLowerCase());
                        if (found) {
                            replaced = true;
                            return `;${found.name};`;
                        }
                        return match;
                    });

                    if (replaced) {
                        const app = getActiveApp();
                        if (app?.commands.e) {
                            logStatus("Proxying emoji message via bot interaction...");
                            const guildId = SelectedGuildStore?.getGuildId() || undefined;
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
                                        options: [{ type: 3, name: "text", value: transformed }],
                                    },
                                    nonce: Date.now().toString(),
                                },
                            });
                            return;
                        }
                    }
                }
                return orig.apply(MessageActions, args);
            })
        );
        logStatus("Patched MessageActions.sendMessage for bot proxy routing");
    } else {
        logStatus("MessageActions not found", true);
    }

    // 4. Bot Ping Forwarder
    unpatches.push(
        instead("dispatch", FluxDispatcher, (args, orig) => {
            const [event] = args;
            if (
                event &&
                (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") &&
                storage.botPingToUserPing
            ) {
                try {
                    const msg = event.message;
                    const botId = storage.selectedAppId;
                    const currentUser = UserStore?.getCurrentUser?.();

                    if (msg && botId && currentUser) {
                        let isPinged = false;
                        if (msg.referenced_message?.author?.id === botId) isPinged = true;
                        if (!isPinged && Array.isArray(msg.mentions) && msg.mentions.some((m: any) => m.id === botId)) {
                            isPinged = true;
                        }

                        if (isPinged) {
                            if (!Array.isArray(msg.mentions)) msg.mentions = [];
                            if (!msg.mentions.some((m: any) => m.id === currentUser.id)) {
                                msg.mentions.push(currentUser);
                            }
                        }
                    }
                } catch {}
            }
            return orig.apply(FluxDispatcher, args);
        })
    );
    logStatus("Patched FluxDispatcher for Bot Ping notifications");

    return () => unpatches.forEach((u) => u?.());
}
