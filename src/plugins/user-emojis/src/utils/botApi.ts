import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";
import { AppEmoji, CommandName, DiscoveredApp } from "../types";
import { logStatus, PLUGIN_TAG } from "./logger";

export const REQUIRED_COMMANDS: CommandName[] = [
    "e",
    "ed",
    "esync",
    "deleteemoji",
    "stealemoji",
    "installpack",
    "uninstallpack",
];

export const emojiRegex = /<a?:([A-Za-z0-9_]+):(\d+)>/g;
export const USER_PICKER_CATEGORY = "User App Emojis";
export const PACKS_URL =
    "https://raw.githubusercontent.com/MORGANlTE/selfhosted-user-emojis-for-free/refs/heads/main/vencord_plugin/packs_index.json";

export const RestAPI = findByProps("get", "post", "del");
export const AuthenticationStore = findByStoreName("AuthenticationStore");
export const SelectedGuildStore = findByStoreName("SelectedGuildStore");
export const SelectedChannelStore = findByProps("getChannelId", "getVoiceChannelId");

export function getEmojiCdnUrl(id: string, animated = false): string {
    if (!id) return "";
    if (id.startsWith("http")) return id;
    const ext = animated ? "gif" : "webp";
    return `https://cdn.discordapp.com/emojis/${id}.${ext}?size=64&quality=lossless`;
}

export function parseRawEmojiTag(rawTag: string) {
    if (!rawTag) return null;
    const trimmed = rawTag.trim();
    if (trimmed.startsWith("http")) {
        return { id: "", name: "", animated: false, url: trimmed };
    }

    const matchWithBrackets = trimmed.match(/^<(a)?:([A-Za-z0-9_]+):(\d+)>$/);
    if (matchWithBrackets) {
        const isAnimated = matchWithBrackets[1] === "a";
        const name = matchWithBrackets[2];
        const id = matchWithBrackets[3];
        return {
            id,
            name,
            animated: isAnimated,
            url: getEmojiCdnUrl(id, isAnimated),
        };
    }

    const matchWithoutBrackets = trimmed.match(/^(a)?:?([A-Za-z0-9_]+):(\d+)$/);
    if (matchWithoutBrackets) {
        const isAnimated = matchWithoutBrackets[1] === "a";
        const name = matchWithoutBrackets[2];
        const id = matchWithoutBrackets[3];
        return {
            id,
            name,
            animated: isAnimated,
            url: getEmojiCdnUrl(id, isAnimated),
        };
    }

    return null;
}

export function buildEmojiObj(emoji: AppEmoji) {
    return {
        id: emoji.id,
        name: emoji.name,
        originalName: emoji.name,
        animated: Boolean(emoji.animated),
        available: true,
        managed: false,
        require_colons: true,
        roles: [],
        url: getEmojiCdnUrl(emoji.id, Boolean(emoji.animated)),
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
}

export function getActiveApp(): DiscoveredApp | undefined {
    return (storage.apps || []).find((a: DiscoveredApp) => a.appId === storage.selectedAppId);
}

export async function dispatchAppCommand(cmdName: CommandName, channelId: string, options: any[] = []) {
    const app = getActiveApp();
    if (!app || !app.commands[cmdName]) {
        showToast(`${PLUGIN_TAG} Command /${cmdName} not found`, 2);
        logStatus(`Dispatch failed: Command /${cmdName} not registered`, true);
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
        showToast(`${PLUGIN_TAG} Sent /${cmdName}`, 1);
        logStatus(`Executed /${cmdName} in channel ${channelId}`);
    } catch (err) {
        showToast(`${PLUGIN_TAG} Failed /${cmdName}`, 2);
        logStatus(`Failed to execute /${cmdName}: ${String(err)}`, true);
    }
}

export async function syncEmojisFromBot(manual = false) {
    try {
        logStatus("Initiating background emoji sync from bot...");
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
                REQUIRED_COMMANDS.slice(0, 4).every((req) => Boolean(a.commands[req]))
            );

            if (storage.apps.length > 0) {
                storage.selectedAppId = storage.apps[0].appId;
                logStatus(`Selected active user app: ${storage.selectedAppId}`);
            }
        }

        const app = getActiveApp();
        if (!app || !app.commands.esync) {
            logStatus("Sync skipped: No active app or /esync command found", true);
            return;
        }
        const activeApp = app;

        const dmReq = await RestAPI.post({
            url: "/users/@me/channels",
            body: { recipients: [activeApp.appId] },
        });
        const dmChannelId = dmReq?.body?.id;
        if (!dmChannelId) return;

        const jsonPromise = new Promise<{ url: string; msgId: string }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
                reject(new Error("Timeout waiting for /esync payload"));
            }, 15000);

            function onMsg(e: any) {
                const msg = e?.message;
                if (msg?.channel_id === dmChannelId && String(msg?.author?.id) === activeApp.appId) {
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
                application_id: activeApp.appId,
                channel_id: dmChannelId,
                session_id: AuthenticationStore.getSessionId(),
                data: {
                    id: activeApp.commands.esync.id,
                    version: activeApp.commands.esync.version,
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
        logStatus(`Successfully synced ${data.length} custom emojis!`);
        if (manual) showToast(`${PLUGIN_TAG} Synced ${data.length} emojis!`, 1);

        try {
            await RestAPI.del({ url: `/channels/${dmChannelId}/messages/${res.msgId}` });
        } catch {}
    } catch (e) {
        logStatus(`Sync error: ${String(e)}`, true);
        if (manual) showToast(`${PLUGIN_TAG} Sync failed`, 2);
    }
}
