import { patcher } from "@vendetta";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { FluxDispatcher, React, ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import Settings from "./settings";
import { EmojiStoreModal } from "./storeModal";
import type { AppEmoji, CommandName, DiscoveredApp } from "./types";

const REQUIRED_COMMANDS: CommandName[] = [
    "e",
    "ed",
    "esync",
    "deleteemoji",
    "stealemoji",
    "renameemoji",
    "installpack",
    "uninstallpack",
];

const emojiRegex = /<a?:([A-Za-z0-9_]+):(\d+)>/g;

const MessageActions = findByProps("sendMessage", "editMessage");
const RestAPI = findByProps("get", "post", "del");
const AuthenticationStore = findByStoreName("AuthenticationStore");
const SelectedGuildStore = findByStoreName("SelectedGuildStore");
const UserStore = findByStoreName("UserStore");
const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
const RowManager = findByProps("createRowFromMessage", "generateRows");
const ChatInput = findByName("ChatInput", false) || findByProps("ChatInput");

let unpatches: Function[] = [];

export function getActiveApp(): DiscoveredApp | undefined {
    return (storage.apps || []).find((a: DiscoveredApp) => a.appId === storage.selectedAppId);
}

export async function dispatchAppCommand(cmdName: CommandName, channelId: string, options: any[] = []) {
    const app = getActiveApp();
    if (!app || !app.commands[cmdName]) {
        showToast(`Command /${cmdName} not found on your app`, 2);
        return;
    }

    const guildId = SelectedGuildStore?.getGuildId() || undefined;
    const cmd = app.commands[cmdName]!;

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
                    id: cmd.id,
                    version: cmd.version,
                    name: cmd.name,
                    type: 1,
                    options,
                },
                nonce: Date.now().toString(),
            },
        });
        showToast(`Executed /${cmdName}`, 1);
    } catch {
        showToast(`Failed to run /${cmdName}`, 2);
    }
}

export async function syncEmojisFromBot(manual = false) {
    try {
        if (!storage.selectedAppId) {
            const cmdData = await RestAPI.get({ url: "/users/@me/application-command-index" });
            const cmds = cmdData?.body?.application_commands || [];
            const appMap = new Map<string, DiscoveredApp>();

            for (const cmd of cmds) {
                const appId = String(cmd?.application_id ?? "");
                if (!appId) continue;
                const app = appMap.get(appId) ?? { appId, appName: cmd?.application?.name || "App", commands: {} };
                const name = String(cmd?.name ?? "").toLowerCase() as CommandName;

                if (REQUIRED_COMMANDS.includes(name)) {
                    app.commands[name] = { id: cmd.id, version: cmd.version, name };
                }
                appMap.set(appId, app);
            }

            storage.apps = Array.from(appMap.values()).filter((a) =>
                REQUIRED_COMMANDS.slice(0, 5).every((req) => Boolean(a.commands[req]))
            );

            if (storage.apps.length > 0) {
                storage.selectedAppId = storage.apps[0].appId;
            }
        }

        const app = getActiveApp();
        if (!app || !app.commands.esync) return;

        const dmReq = await RestAPI.post({
            url: "/users/@me/channels",
            body: { recipients: [app.appId] },
        });
        const dmChannelId = dmReq?.body?.id;
        if (!dmChannelId) return;

        const jsonPromise = new Promise<{ url: string; msgId: string }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
                reject(new Error("Timeout"));
            }, 15000);

            function onMsg(e: any) {
                const msg = e?.message;
                if (msg?.channel_id === dmChannelId && String(msg?.author?.id) === app.appId) {
                    const att = msg?.attachments?.find((a: any) =>
                        String(a?.filename).toLowerCase() === "emojis.json"
                    );
                    if (att?.url) {
                        clearTimeout(timeout);
                        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
                        resolve({ url: att.url, msgId: msg.id });
                    }
                }
            }
            FluxDispatcher.subscribe("MESSAGE_CREATE", onMsg);
        });

        await RestAPI.post({
            url: "/interactions",
            body: {
                type: 2,
                application_id: app.appId,
                channel_id: dmChannelId,
                session_id: AuthenticationStore.getSessionId(),
                data: {
                    id: app.commands.esync.id,
                    version: app.commands.esync.version,
                    name: "esync",
                    type: 1,
                },
                nonce: Date.now().toString(),
            },
        });

        const res = await jsonPromise;
        const emojisReq = await fetch(res.url);
        const data: AppEmoji[] = await emojisReq.json();

        storage.emojis = data;
        if (manual) showToast("Synced emojis successfully!", 1);

        try {
            await RestAPI.del({ url: `/channels/${dmChannelId}/messages/${res.msgId}` });
        } catch {}
    } catch {
        if (manual) showToast("Failed to sync emojis", 2);
    }
}

export default {
    settings: Settings,
    onLoad() {
        if (!storage.emojis) storage.emojis = [];
        if (!storage.apps) storage.apps = [];
        if (storage.botPingToUserPing === undefined) storage.botPingToUserPing = true;
        if (!storage.packIndexUrl) {
            storage.packIndexUrl =
                "https://raw.githubusercontent.com/MORGANlTE/selfhosted-user-emojis-for-free/refs/heads/main/vencord_plugin/packs_index.json";
        }

        syncEmojisFromBot(false);

        // 1. Message Interceptor (Sending & Proxying)
        if (MessageActions) {
            unpatches.push(
                patcher.instead("sendMessage", MessageActions, async (args, orig) => {
                    const [channelId, message] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];

                    if (message?.content && loaded.length > 0) {
                        let replaced = false;
                        const emojiMap = new Map(loaded.map((e) => [e.name.toLowerCase(), e]));

                        const transformed = String(message.content).replace(
                            emojiRegex,
                            (match, tag, _id) => {
                                const raw = tag.toLowerCase();
                                const found = emojiMap.get(raw);
                                if (found) {
                                    replaced = true;
                                    return `;${found.name};`;
                                }
                                return match;
                            }
                        );

                        if (replaced) {
                            const app = getActiveApp();
                            if (app?.commands.e) {
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
        }

        // 2. Chat UI Message Rendering (Replace ;emoji; syntax in incoming chat rows)
        if (RowManager?.createRowFromMessage) {
            unpatches.push(
                patcher.after("createRowFromMessage", RowManager, (args, res) => {
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (res?.message?.content && loaded.length > 0) {
                        const emojiMap = new Map(loaded.map((e) => [e.name.toLowerCase(), e]));
                        res.message.content = res.message.content.replace(
                            /;([A-Za-z0-9_]+);/g,
                            (match: string, name: string) => {
                                const found = emojiMap.get(name.toLowerCase());
                                if (found) {
                                    return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
                                }
                                return match;
                            }
                        );
                    }
                    return res;
                })
            );
        }

        // 3. Bot Mention Interceptor (Bot Ping -> User Ping)
        unpatches.push(
            patcher.instead("dispatch", FluxDispatcher, (args, orig) => {
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

        // 4. In-Chat Access Button (Mounts 💎 button directly onto mobile Chat Input Bar)
        if (ChatInput) {
            unpatches.push(
                patcher.after("default", ChatInput, (_, res) => {
                    const children = res?.props?.children;
                    if (!children) return res;

                    const EmojiPickerButton = (
                        <RN.TouchableOpacity
                            key="user-emoji-store-btn"
                            onPress={() => {
                                if (LazyActionSheet?.openLazy) {
                                    LazyActionSheet.openLazy(
                                        async () => () => <EmojiStoreModal />,
                                        "CustomEmojiStoreSheet"
                                    );
                                }
                            }}
                            style={{
                                justifyContent: "center",
                                alignItems: "center",
                                paddingHorizontal: 8,
                            }}
                        >
                            <RN.Text style={{ fontSize: 20 }}>💎</RN.Text>
                        </RN.TouchableOpacity>
                    );

                    if (Array.isArray(children)) {
                        children.unshift(EmojiPickerButton);
                    }
                    return res;
                })
            );
        }

        // 5. Message Long-Press Steal Emoji Hook
        if (LazyActionSheet?.openLazy) {
            unpatches.push(
                patcher.before("openLazy", LazyActionSheet, (args) => {
                    const [factory, key] = args;
                    if (key === "MessageLongPressActionSheet" || key === "MessageActionsActionSheet") {
                        args[0] = async () => {
                            const Component = await factory();
                            return (props: any) => {
                                const rendered = Component(props);
                                const message = props?.message;
                                const content = message?.content || "";
                                const app = getActiveApp();

                                if (!rendered || !app) return rendered;

                                const matches = Array.from(content.matchAll(/<a?:([A-Za-z0-9_]+):(\d+)>/g));
                                if (matches.length > 0) {
                                    const stealActions = matches.map((m) => {
                                        const raw = m[0];
                                        const name = m[1];
                                        return (
                                            <RN.TouchableOpacity
                                                key={`steal-${name}`}
                                                onPress={() => {
                                                    if (LazyActionSheet.hideActionSheet) LazyActionSheet.hideActionSheet();
                                                    dispatchAppCommand("stealemoji", message.channel_id, [
                                                        { type: 3, name: "emoji", value: raw },
                                                        { type: 3, name: "new_name", value: name },
                                                    ]);
                                                }}
                                                style={{
                                                    padding: 12,
                                                    flexDirection: "row",
                                                    alignItems: "center",
                                                    backgroundColor: "rgba(255,255,255,0.05)",
                                                    borderRadius: 8,
                                                    marginVertical: 4,
                                                }}
                                            >
                                                <RN.Text style={{ color: "#fff", fontWeight: "bold" }}>
                                                    Steal :{name}:
                                                </RN.Text>
                                            </RN.TouchableOpacity>
                                        );
                                    });

                                    // Safely wrap and inject buttons without breaking the ActionSheet tree
                                    return (
                                        <RN.View style={{ flex: 1 }}>
                                            {rendered}
                                            <RN.View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                                                {stealActions}
                                            </RN.View>
                                        </RN.View>
                                    );
                                }

                                return rendered;
                            };
                        };
                    }
                })
            );
        }
    },

    onUnload() {
        for (const unpatch of unpatches) unpatch();
        unpatches = [];
    },
};
