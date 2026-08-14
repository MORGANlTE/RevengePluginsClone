import { React, ReactNative as RN } from "@vendetta/metro/common";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { after, before, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";

import { patchMessageActionSheet } from "./contextMenu";
import { CustomEmojiStorePopout } from "./emojiStore";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { findInReactTree } from "@vendetta/utils";
import type { AppEmoji, CommandMeta, CommandName, DiscoveredApp, PluginCache } from "./types";

const messaging = findByProps("sendMessage", "editMessage");
const RestAPI = findByProps("get", "post", "put", "patch", "delete");
const { getSessionId } = findByProps("getSessionId") ?? { getSessionId: () => "" };
const SnowflakeUtils = findByProps("fromTimestamp") ?? { fromTimestamp: (t: number) => String(t) };
const SelectedGuildStore = findByStoreName("SelectedGuildStore");

const CACHE_KEY = "userEmojiPicker.cache.v10";
const USER_PICKER_CATEGORY = "User App Emojis";

const REQUIRED_COMMANDS: CommandName[] = [
    "e", "ed", "esync", "deleteemoji", "stealemoji"
];

const vstorage = storage as {
    selectedAppId: string;
    storeName: string;
    storeBackground: string;
    cache: PluginCache | null;
};

const pluginStore = {
    loadedEmojis: new Map<string, AppEmoji>(),
    customEmojiObjectsById: new Map<string, any>(),
    apps: [] as DiscoveredApp[],
    selectedAppId: "",
    isSyncing: false,

    getSetting(key: string) {
        return (vstorage as any)[key];
    },

    get cache(): PluginCache {
        return {
            selectedAppId: this.selectedAppId,
            apps: this.apps,
            emojis: Array.from(this.loadedEmojis.values()),
            updatedAt: Date.now(),
        };
    },

    saveCache() {
        vstorage.cache = this.cache;
    },

    loadCache() {
        try {
            const parsed = vstorage.cache;
            if (!parsed) return;
            this.apps = Array.isArray(parsed.apps) ? parsed.apps : [];
            this.selectedAppId = parsed.selectedAppId || vstorage.selectedAppId || "";
            this.hydrateEmojis(Array.isArray(parsed.emojis) ? parsed.emojis : []);
        } catch (err) {}
    },

    hydrateEmojis(items: AppEmoji[]) {
        this.loadedEmojis.clear();
        this.customEmojiObjectsById.clear();
        for (const emoji of items) {
            this.loadedEmojis.set(emoji.name.toLowerCase(), emoji);
            this.customEmojiObjectsById.set(emoji.id, this.buildEmojiObj(emoji));
        }
    },

    buildEmojiObj(emoji: AppEmoji) {
        const ext = emoji.animated ? "gif" : "png";
        return {
            id: emoji.id,
            name: emoji.name,
            originalName: emoji.name,
            animated: emoji.animated,
            available: true,
            managed: false,
            require_colons: true,
            roles: [],
            url: `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=48&quality=lossless`,
            allNamesString: `:${emoji.name}:`,
            type: 3,
            category: USER_PICKER_CATEGORY,
            categoryName: USER_PICKER_CATEGORY,
            source: "discord",
            score: 2147483647,
            isLocked: false,
            locked: false,
            disabled: false,
            guildId: "UserAppEmojis",
        };
    },

    getSelectedApp(): DiscoveredApp | undefined {
        return this.apps.find((a) => a.appId === this.selectedAppId);
    },
    getCommand(name: CommandName): CommandMeta | undefined {
        return this.getSelectedApp()?.commands[name];
    },
    
    async discoverInstalledApps() {
        const data = await RestAPI.get({ url: "/users/@me/application-command-index" });
        const body = (data as any)?.body ?? data;
        const commands = Array.isArray(body?.application_commands) ? body.application_commands : [];
        if (!commands.length) throw new Error("application_commands empty");

        const appMap = new Map<string, DiscoveredApp>();

        for (const cmd of commands) {
            const appId = String(cmd?.application_id ?? "");
            if (!appId) continue;
            const appName = String(cmd?.application?.name ?? `App ${appId}`);
            const name = String(cmd?.name ?? "").replace(/^\//, "").toLowerCase();
            const id = String(cmd?.id ?? "");
            const version = String(cmd?.version ?? "");

            const app = appMap.get(appId) ?? ({ appId, appName, commands: {} } as DiscoveredApp);

            if (REQUIRED_COMMANDS.includes(name as CommandName) && id && version) {
                app.commands[name as CommandName] = { id, version, name: name as CommandName };
            }
            appMap.set(appId, app);
        }

        this.apps = Array.from(appMap.values()).filter((app) =>
            REQUIRED_COMMANDS.every((required) => Boolean(app.commands[required]))
        );

        if (!this.apps.length) throw new Error("No installed app found with required commands");

        if (!this.selectedAppId || !this.apps.some((a) => a.appId === this.selectedAppId)) {
            this.selectedAppId = this.apps[0].appId;
            vstorage.selectedAppId = this.selectedAppId;
        }
    },

    async ensureDmChannelForApp(appId: string): Promise<string> {
        const resp = await RestAPI.post({
            url: "/users/@me/channels",
            body: { recipients: [appId] },
        });
        const body = (resp as any)?.body ?? resp;
        const channelId = String(body?.id ?? "");
        if (!channelId) throw new Error("Could not resolve DM channel");
        return channelId;
    },

    async dispatchInteraction(input: { appId: string; command: CommandMeta; channelId: string; guildId?: string; options?: any[] }) {
        const { appId, command, channelId, guildId, options = [] } = input;
        return RestAPI.post({
            url: "/interactions",
            body: {
                type: 2,
                application_id: appId,
                guild_id: guildId,
                channel_id: channelId,
                session_id: getSessionId(),
                data: {
                    id: command.id,
                    version: command.version,
                    name: command.name,
                    type: 1,
                    options,
                },
                nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                analytics_location: "slash_ui",
                attachments: [],
            },
        });
    }
};

const emojiRegex = /<a?:([A-Za-z0-9_]+):(\d+)>|:([A-Za-z0-9_]+):|;([A-Za-z0-9_]+);/g;

let patches: (() => void)[] = [];

export function onLoad() {
    console.log("Morganite plugin loaded");
    
    vstorage.storeName ??= "💎 Custom Emojis";
    vstorage.storeBackground ??= "https://i.pinimg.com/236x/2c/cd/9d/2ccd9d9501e6ecbcca340a868ddd1184.jpg";

    pluginStore.selectedAppId = vstorage.selectedAppId || "";
    pluginStore.loadCache();

    patches.push(patchMessageActionSheet(() => ({ selectedApp: pluginStore.getSelectedApp() })));

    patches.push(instead("editMessage", messaging, (args, orig) => {
        const [channelId, messageId, message] = args;
        if (message?.content && pluginStore.loadedEmojis.size > 0) {
            message.content = String(message.content).replace(
                emojiRegex,
                (match: string, tagName: string, _tagId: string, colonName: string, semiName: string) => {
                    const rawName = (tagName || colonName || semiName || "").toLowerCase();
                    const found = pluginStore.loadedEmojis.get(rawName);
                    if (!found) return match;
                    return `;${found.name};`;
                }
            );
        }
        return orig(...args);
    }));

    patches.push(instead("sendMessage", messaging, async (args, orig) => {
        const [channelId, message, promise, extra] = args;

        if (message?.content && pluginStore.loadedEmojis.size > 0) {
            let hasAppEmoji = false;
            const transformed = String(message.content).replace(
                emojiRegex,
                (match: string, tagName: string, _tagId: string, colonName: string, semiName: string) => {
                    if (semiName === "random") {
                        const allEmojisArr = Array.from(pluginStore.loadedEmojis.values());
                        if (allEmojisArr.length > 0) {
                            hasAppEmoji = true;
                            const randomEmoji = allEmojisArr[Math.floor(Math.random() * allEmojisArr.length)];
                            return `;${randomEmoji.name};`;
                        }
                        return match;
                    }
                    const rawName = (tagName || colonName || semiName || "").toLowerCase();
                    const found = pluginStore.loadedEmojis.get(rawName);
                    if (!found) return match;
                    hasAppEmoji = true;
                    return `;${found.name};`;
                }
            );

            if (hasAppEmoji) {
                const app = pluginStore.getSelectedApp();
                const eCmd = pluginStore.getCommand("e");
                if (!app || !eCmd) {
                    showToast("Message not intercepted by bot. No bot selected?", getAssetIDByName("Small"));
                    return orig(...args);
                }

                const options: any[] = [{ type: 3, name: "text", value: transformed }];
                const guildId = SelectedGuildStore?.getGuildId?.() || undefined;

                try {
                    await pluginStore.dispatchInteraction({
                        appId: app.appId,
                        command: eCmd,
                        channelId,
                        guildId,
                        options,
                    });
                    return Promise.resolve({ code: 0 });
                } catch (err) {
                    showToast("Message not intercepted by bot (Error)", getAssetIDByName("Small"));
                    return orig(...args);
                }
            }
        }
        return orig(...args);
    }));

    patches.push(instead("post", RestAPI, async (args, orig) => {
        const [req] = args;
        if (req.url === "/interactions" && req.body && req.body.type === 2) {
            const cmdName = req.body.data?.name;
            const options = req.body.data?.options || [];

            if (cmdName === "renameemoji") {
                const oldNameOpt = options.find((o: any) => o.name === "old_name");
                const newNameOpt = options.find((o: any) => o.name === "new_name");
                if (oldNameOpt && newNameOpt) {
                    const oldName = String(oldNameOpt.value).replace(/[:;]/g, "").toLowerCase();
                    const newName = String(newNameOpt.value).replace(/[:;]/g, "").toLowerCase();
                    const emojiObj = pluginStore.loadedEmojis.get(oldName);
                    if (emojiObj) {
                        emojiObj.name = newName;
                        pluginStore.loadedEmojis.delete(oldName);
                        pluginStore.loadedEmojis.set(newName, emojiObj);
                        pluginStore.customEmojiObjectsById.set(emojiObj.id, pluginStore.buildEmojiObj(emojiObj));
                        pluginStore.saveCache();
                    }
                }
            } else if (cmdName === "deleteemoji") {
                const nameOpt = options.find((o: any) => o.name === "name");
                if (nameOpt) {
                    const delName = String(nameOpt.value).replace(/[:;]/g, "").toLowerCase();
                    const emojiObj = pluginStore.loadedEmojis.get(delName);
                    if (emojiObj) {
                        pluginStore.loadedEmojis.delete(delName);
                        pluginStore.customEmojiObjectsById.delete(emojiObj.id);
                        pluginStore.saveCache();
                    }
                }
            } else if (cmdName === "uninstallpack") {
                const packOpt = options.find((o: any) => o.name === "pack_name");
                if (packOpt) {
                    const packNamePrefix = String(packOpt.value).toLowerCase() + "_";
                    let deletedAny = false;
                    for (const [name, emoji] of pluginStore.loadedEmojis.entries()) {
                        if (name.startsWith(packNamePrefix)) {
                            pluginStore.loadedEmojis.delete(name);
                            pluginStore.customEmojiObjectsById.delete(emoji.id);
                            deletedAny = true;
                        }
                    }
                    if (deletedAny) {
                        pluginStore.saveCache();
                    }
                }
            }
        }
        return orig(...args);
    }));

    const ChatInputGuardWrapper = findByName("ChatInputGuardWrapper", false);
    if (ChatInputGuardWrapper) {
        patches.push(after("default", ChatInputGuardWrapper, (_, ret) => {
            const children = ret?.props?.children;
            if (!children || !Array.isArray(children)) return;

            const EmojiStoreButton = () => {
                const [visible, setVisible] = React.useState(false);
                return (
                    <>
                        <RN.Pressable onPress={() => setVisible(true)} style={{ justifyContent: "center", paddingHorizontal: 4 }}>
                            <RN.Image source={getAssetIDByName("EmojiIcon")} style={{ width: 24, height: 24, tintColor: "var(--interactive-normal)" }} />
                        </RN.Pressable>
                        <RN.Modal visible={visible} transparent={true} animationType="slide" onRequestClose={() => setVisible(false)}>
                            <RN.View style={{ flex: 1, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)", padding: 20 }}>
                                <CustomEmojiStorePopout pluginStore={pluginStore} onClose={() => setVisible(false)} />
                                <RN.Button title="Close" color="#ed4245" onPress={() => setVisible(false)} />
                            </RN.View>
                        </RN.Modal>
                    </>
                );
            };

            children.unshift(React.createElement(EmojiStoreButton));
        }));
    }
}

export function onUnload() {
    patches.forEach(p => p());
    patches = [];
    console.log("Morganite plugin unloaded");
}
