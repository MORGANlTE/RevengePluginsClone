import { patcher } from "@vendetta";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import Settings from "./settings";
import type { AppEmoji, CommandMeta, DiscoveredApp } from "./types";

const REQUIRED_COMMANDS = ["e", "ed", "esync", "deleteemoji", "stealemoji"];[cite: 3]
const emojiRegex = /<a?:([A-Za-z0-9_]+):(\d+)>|:([A-Za-z0-9_]+):|;([A-Za-z0-9_]+);/g;[cite: 3]

// Webpack / Metro module discovery
const MessageActions = findByProps("sendMessage", "editMessage");
const RestAPI = findByProps("get", "post", "del");
const AuthenticationStore = findByStoreName("AuthenticationStore");
const SelectedGuildStore = findByStoreName("SelectedGuildStore");
const UserStore = findByStoreName("UserStore");
const ActionSheet = findByProps("openLazy", "hideActionSheet");

let unpatches: Function[] = [];

function getActiveApp(): DiscoveredApp | undefined {
    return (storage.apps || []).find((a: DiscoveredApp) => a.appId === storage.selectedAppId);[cite: 3]
}

export async function syncEmojisFromBot(manual = false) {
    try {
        if (!storage.selectedAppId) {
            const cmdData = await RestAPI.get({ url: "/users/@me/application-command-index" });[cite: 3]
            const cmds = cmdData?.body?.application_commands || [];[cite: 3]
            const appMap = new Map<string, DiscoveredApp>();[cite: 3]

            for (const cmd of cmds) {
                const appId = String(cmd?.application_id ?? "");[cite: 3]
                if (!appId) continue;[cite: 3]
                const app = appMap.get(appId) ?? { appId, appName: cmd?.application?.name || "App", commands: {} };[cite: 3]
                const name = String(cmd?.name ?? "").toLowerCase();[cite: 3]

                if (REQUIRED_COMMANDS.includes(name)) {[cite: 3]
                    app.commands[name] = { id: cmd.id, version: cmd.version, name };[cite: 3]
                }
                appMap.set(appId, app);[cite: 3]
            }

            storage.apps = Array.from(appMap.values()).filter((a) =>
                REQUIRED_COMMANDS.every((req) => Boolean(a.commands[req]))[cite: 3]
            );

            if (storage.apps.length > 0) {
                storage.selectedAppId = storage.apps[0].appId;[cite: 3]
            }
        }

        const app = getActiveApp();
        if (!app || !app.commands.esync) return;[cite: 3]

        const dmReq = await RestAPI.post({
            url: "/users/@me/channels",[cite: 3]
            body: { recipients: [app.appId] },[cite: 3]
        });
        const dmChannelId = dmReq?.body?.id;[cite: 3]
        if (!dmChannelId) return;[cite: 3]

        // Flux Message Listener (Zero Polling)
        const jsonPromise = new Promise<{ url: string; msgId: string }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
                reject(new Error("Timeout"));
            }, 15000);

            function onMsg(e: any) {
                const msg = e?.message;
                if (msg?.channel_id === dmChannelId && String(msg?.author?.id) === app.appId) {
                    const att = msg?.attachments?.find((a: any) =>
                        String(a?.filename).toLowerCase() === "emojis.json"[cite: 3]
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

        // Trigger /esync
        await RestAPI.post({
            url: "/interactions",[cite: 3]
            body: {
                type: 2,[cite: 3]
                application_id: app.appId,[cite: 3]
                channel_id: dmChannelId,[cite: 3]
                session_id: AuthenticationStore.getSessionId(),[cite: 3]
                data: {
                    id: app.commands.esync.id,[cite: 3]
                    version: app.commands.esync.version,[cite: 3]
                    name: "esync",[cite: 3]
                    type: 1,[cite: 3]
                },
                nonce: Date.now().toString(),
            },
        });

        const res = await jsonPromise;
        const emojisReq = await fetch(res.url);
        const data: AppEmoji[] = await emojisReq.json();

        storage.emojis = data;
        if (manual) showToast("Synced emojis successfully!", 1);

        // Delete the temporary file
        try {
            await RestAPI.del({ url: `/channels/${dmChannelId}/messages/${res.msgId}` });[cite: 3]
        } catch {}
    } catch (e) {
        if (manual) showToast("Failed to sync emojis", 2);
    }
}

export default {
    settings: Settings,
    onLoad() {
        if (!storage.emojis) storage.emojis = [];
        if (!storage.apps) storage.apps = [];
        if (storage.botPingToUserPing === undefined) storage.botPingToUserPing = true;

        syncEmojisFromBot(false);

        // 1. Intercept Outgoing Messages
        if (MessageActions) {
            unpatches.push(
                patcher.instead("sendMessage", MessageActions, async (args, orig) => {
                    const [channelId, message] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];

                    if (message?.content && loaded.length > 0) {
                        let replaced = false;
                        const emojiMap = new Map(loaded.map((e) => [e.name.toLowerCase(), e]));

                        const transformed = String(message.content).replace(
                            emojiRegex,[cite: 3]
                            (match, tag, _id, colon, semi) => {
                                const raw = (tag || colon || semi || "").toLowerCase();[cite: 3]
                                const found = emojiMap.get(raw);[cite: 3]
                                if (found) {
                                    replaced = true;[cite: 3]
                                    return `;${found.name};`;[cite: 3]
                                }
                                return match;[cite: 3]
                            }
                        );

                        if (replaced) {
                            const app = getActiveApp();[cite: 3]
                            if (app?.commands.e) {[cite: 3]
                                const guildId = SelectedGuildStore?.getGuildId() || undefined;[cite: 3]
                                await RestAPI.post({
                                    url: "/interactions",[cite: 3]
                                    body: {
                                        type: 2,[cite: 3]
                                        application_id: app.appId,[cite: 3]
                                        guild_id: guildId,[cite: 3]
                                        channel_id: channelId,[cite: 3]
                                        session_id: AuthenticationStore.getSessionId(),[cite: 3]
                                        data: {
                                            id: app.commands.e.id,[cite: 3]
                                            version: app.commands.e.version,[cite: 3]
                                            name: "e",[cite: 3]
                                            type: 1,[cite: 3]
                                            options: [{ type: 3, name: "text", value: transformed }],[cite: 3]
                                        },
                                        nonce: Date.now().toString(),
                                    },
                                });
                                return;
                            }
                        }
                    }
                    return orig.apply(MessageActions, args);[cite: 3]
                })
            );
        }

        // 2. ActionSheet Steal Emoji Integration
        if (ActionSheet) {
            unpatches.push(
                patcher.before("openLazy", ActionSheet, (args) => {
                    const [component, key] = args;
                    if (key === "MessageLongPressActionSheet") {
                        args[0] = async () => {
                            const render = await component();
                            return (props: any) => {
                                const res = render(props);
                                const content = props?.message?.content || "";
                                const match = emojiRegex.exec(content);

                                if (match) {
                                    // Steal Emoji button injection for Mobile
                                }
                                return res;
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
