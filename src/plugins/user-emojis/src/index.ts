import { patcher } from "@vendetta";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import Settings from "./settings";
import type { AppEmoji, CommandMeta, DiscoveredApp } from "./types";

const REQUIRED_COMMANDS = ["e", "ed", "esync", "deleteemoji", "stealemoji"];
const emojiRegex = /<a?:([A-Za-z0-9_]+):(\d+)>|:([A-Za-z0-9_]+):|;([A-Za-z0-9_]+);/g;

// Webpack / Metro module discovery
const MessageActions = findByProps("sendMessage", "editMessage");
const RestAPI = findByProps("get", "post", "del");
const AuthenticationStore = findByStoreName("AuthenticationStore");
const SelectedGuildStore = findByStoreName("SelectedGuildStore");
const ActionSheet = findByProps("openLazy", "hideActionSheet");

let unpatches: Function[] = [];

function getActiveApp(): DiscoveredApp | undefined {
    return (storage.apps || []).find((a: DiscoveredApp) => a.appId === storage.selectedAppId);
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
                const name = String(cmd?.name ?? "").toLowerCase();

                if (REQUIRED_COMMANDS.includes(name)) {
                    app.commands[name] = { id: cmd.id, version: cmd.version, name };
                }
                appMap.set(appId, app);
            }

            storage.apps = Array.from(appMap.values()).filter((a) =>
                REQUIRED_COMMANDS.every((req) => Boolean(a.commands[req]))
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

        // Trigger /esync
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

        // Delete the temporary sync file
        try {
            await RestAPI.del({ url: `/channels/${dmChannelId}/messages/${res.msgId}` });
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
                            emojiRegex,
                            (match, tag, _id, colon, semi) => {
                                const raw = (tag || colon || semi || "").toLowerCase();
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

        // 2. ActionSheet Steal Emoji Hook
        if (ActionSheet) {
            unpatches.push(
                patcher.before("openLazy", ActionSheet, (args) => {
                    const [component, key] = args;
                    if (key === "MessageLongPressActionSheet") {
                        args[0] = async () => {
                            const render = await component();
                            return (props: any) => render(props);
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
