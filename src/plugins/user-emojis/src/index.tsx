import { patcher } from "@vendetta";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { FluxDispatcher, React, ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { Forms } from "@vendetta/ui/components";
import { registerCommand } from "@vendetta/commands";
import { useProxy } from "@vendetta/storage";

// --- TYPES ---
export type CommandName = "e" | "ed" | "esync" | "deleteemoji" | "stealemoji" | "installpack" | "uninstallpack";

export interface CommandMeta {
    id: string;
    version: string;
    name: CommandName;
}

export interface DiscoveredApp {
    appId: string;
    appName: string;
    commands: Partial<Record<CommandName, CommandMeta>>;
}

export interface AppEmoji {
    id: string;
    name: string;
    animated: boolean;
}

export interface EmojiPack {
    name: string;
    description?: string;
    iconUrl?: string;
    emojis: Record<string, string>;
}

// --- CONSTANTS ---
const PLUGIN_TAG = "[UserEmojiPicker]";
const REQUIRED_COMMANDS: CommandName[] = [
    "e",
    "ed",
    "esync",
    "deleteemoji",
    "stealemoji",
    "installpack",
    "uninstallpack",
];
const emojiRegex = /<a?:([A-Za-z0-9_]+):(\d+)>/g;
const PACKS_URL =
    "https://raw.githubusercontent.com/MORGANlTE/selfhosted-user-emojis-for-free/refs/heads/main/vencord_plugin/packs_index.json";

// --- METRO MODULE RESOLVER ---
const MessageActions = findByProps("sendMessage", "editMessage");
const RestAPI = findByProps("get", "post", "del");
const AuthenticationStore = findByStoreName("AuthenticationStore");
const SelectedGuildStore = findByStoreName("SelectedGuildStore");
const SelectedChannelStore = findByProps("getChannelId", "getVoiceChannelId");
const UserStore = findByStoreName("UserStore");
const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
const RowManager = findByProps("createRowFromMessage", "generateRows");
const ChatInput = findByName("ChatInput", false) || findByProps("ChatInput");

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;
let unpatches: Function[] = [];

// --- IN-APP LOGGER ---
function logStatus(msg: string, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `${timestamp} ${msg}`;
    if (!storage.debugLogs) storage.debugLogs = [];
    storage.debugLogs.unshift(formatted);
    if (storage.debugLogs.length > 30) storage.debugLogs.pop();

    if (isError) {
        console.error(`${PLUGIN_TAG} 🔴 ${msg}`);
    } else {
        console.log(`${PLUGIN_TAG} 🟢 ${msg}`);
    }
}

export function getActiveApp(): DiscoveredApp | undefined {
    return (storage.apps || []).find((a: DiscoveredApp) => a.appId === storage.selectedAppId);
}

export async function dispatchAppCommand(cmdName: CommandName, channelId: string, options: any[] = []) {
    const app = getActiveApp();
    if (!app || !app.commands[cmdName]) {
        showToast(`${PLUGIN_TAG} Command /${cmdName} not found on your app`, 2);
        logStatus(`Dispatch failed: /${cmdName} not registered`, true);
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
        showToast(`${PLUGIN_TAG} Fired /${cmdName}`, 1);
        logStatus(`Executed /${cmdName} in channel ${channelId}`);
    } catch (err) {
        showToast(`${PLUGIN_TAG} Failed /${cmdName}`, 2);
        logStatus(`API Error executing /${cmdName}: ${String(err)}`, true);
    }
}

export async function syncEmojisFromBot(manual = false) {
    try {
        logStatus("Starting /esync background sync...");
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
                logStatus(`Auto-selected User App ID: ${storage.selectedAppId}`);
            }
        }

        const app = getActiveApp();
        if (!app || !app.commands.esync) {
            logStatus("Missing active app or /esync command", true);
            return;
        }

        const dmReq = await RestAPI.post({
            url: "/users/@me/channels",
            body: { recipients: [app.appId] },
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
        logStatus(`Synced ${data.length} emojis successfully.`);
        if (manual) showToast(`${PLUGIN_TAG} Synced ${data.length} emojis!`, 1);

        try {
            await RestAPI.del({ url: `/channels/${dmChannelId}/messages/${res.msgId}` });
        } catch {}
    } catch (e) {
        logStatus(`Sync error: ${String(e)}`, true);
        if (manual) showToast(`${PLUGIN_TAG} Sync failed`, 2);
    }
}

// --- EMOJI STORE MODAL ---
function EmojiStoreModal() {
    const [tab, setTab] = React.useState<"emojis" | "market">("emojis");
    const [search, setSearch] = React.useState("");
    const [remotePacks, setRemotePacks] = React.useState<EmojiPack[]>([]);
    const [loadingPacks, setLoadingPacks] = React.useState(false);

    const emojis: AppEmoji[] = storage.emojis || [];

    React.useEffect(() => {
        if (tab === "market" && remotePacks.length === 0) {
            setLoadingPacks(true);
            fetch(PACKS_URL)
                .then((res) => res.json())
                .then((data) => setRemotePacks(Array.isArray(data) ? data : []))
                .catch((e) => logStatus(`Market fetch failed: ${e}`, true))
                .finally(() => setLoadingPacks(false));
        }
    }, [tab]);

    const filteredEmojis = emojis.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()));

    const handleSendEmoji = (emoji: AppEmoji) => {
        const channelId = SelectedChannelStore?.getChannelId();
        if (!channelId) {
            showToast(`${PLUGIN_TAG} No active channel found`, 2);
            return;
        }
        const tag = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
        try {
            MessageActions.sendMessage(channelId, { content: tag });
            if (LazyActionSheet?.hideActionSheet) LazyActionSheet.hideActionSheet();
        } catch {
            RN.Clipboard.setString(tag);
            showToast(`${PLUGIN_TAG} Copied :${emoji.name}: to clipboard!`, 1);
        }
    };

    return (
        <RN.ScrollView style={{ flex: 1, backgroundColor: "#1e1f22", padding: 12 }}>
            <RN.View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 12 }}>
                <RN.TouchableOpacity
                    onPress={() => setTab("emojis")}
                    style={{
                        paddingVertical: 8,
                        paddingHorizontal: 24,
                        backgroundColor: tab === "emojis" ? "#5865F2" : "rgba(255,255,255,0.1)",
                        borderRadius: 8,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontWeight: "bold" }}>Emojis ({emojis.length})</RN.Text>
                </RN.TouchableOpacity>
                <RN.TouchableOpacity
                    onPress={() => setTab("market")}
                    style={{
                        paddingVertical: 8,
                        paddingHorizontal: 24,
                        backgroundColor: tab === "market" ? "#5865F2" : "rgba(255,255,255,0.1)",
                        borderRadius: 8,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontWeight: "bold" }}>Market</RN.Text>
                </RN.TouchableOpacity>
            </RN.View>

            {tab === "emojis" ? (
                <>
                    <FormInput
                        title="Filter Emojis"
                        value={search}
                        placeholder="Search custom emojis..."
                        onChange={setSearch}
                    />
                    <RN.View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 12 }}>
                        {filteredEmojis.map((emoji) => {
                            const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=48&quality=lossless`;
                            return (
                                <RN.TouchableOpacity
                                    key={emoji.id}
                                    onPress={() => handleSendEmoji(emoji)}
                                    style={{
                                        alignItems: "center",
                                        justifyContent: "center",
                                        padding: 6,
                                        backgroundColor: "rgba(255,255,255,0.06)",
                                        borderRadius: 8,
                                        width: 48,
                                        height: 48,
                                    }}
                                >
                                    <RN.Image
                                        source={{ uri: url }}
                                        style={{ width: 32, height: 32 }}
                                        resizeMode="contain"
                                    />
                                </RN.TouchableOpacity>
                            );
                        })}
                    </RN.View>
                </>
            ) : (
                <FormSection title="Pack Market">
                    {loadingPacks && <RN.Text style={{ color: "#aaa", textAlign: "center" }}>Fetching remote packs...</RN.Text>}
                    {remotePacks.map((pack) => {
                        const isInstalled = pack.emojis && Object.keys(pack.emojis).some((name) =>
                            emojis.some((e) => e.name.toLowerCase() === name.toLowerCase())
                        );

                        return (
                            <FormRow
                                key={pack.name}
                                label={pack.name.toUpperCase()}
                                subLabel={pack.description || `${Object.keys(pack.emojis || {}).length} emojis`}
                                trailing={() => (
                                    <RN.TouchableOpacity
                                        onPress={async () => {
                                            const channelId = SelectedChannelStore?.getChannelId();
                                            if (!channelId) return;
                                            if (isInstalled) {
                                                await dispatchAppCommand("uninstallpack", channelId, [
                                                    { type: 3, name: "pack_name", value: pack.name },
                                                ]);
                                            } else {
                                                await dispatchAppCommand("installpack", channelId, [
                                                    { type: 3, name: "pack_name", value: pack.name },
                                                ]);
                                            }
                                        }}
                                        style={{
                                            backgroundColor: isInstalled ? "#ED4245" : "#5865F2",
                                            paddingVertical: 6,
                                            paddingHorizontal: 12,
                                            borderRadius: 6,
                                        }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>
                                            {isInstalled ? "Uninstall" : "Install"}
                                        </RN.Text>
                                    </RN.TouchableOpacity>
                                )}
                            />
                        );
                    })}
                </FormSection>
            )}
        </RN.ScrollView>
    );
}

// --- SETTINGS VIEW ---
function Settings() {
    useProxy(storage);

    return (
        <RN.ScrollView style={{ flex: 1, padding: 12 }}>
            <FormSection title="Actions">
                <FormRow
                    label="Open Emoji Store Picker"
                    subLabel="Browse emojis and install community packs"
                    onPress={() => {
                        if (LazyActionSheet?.openLazy) {
                            LazyActionSheet.openLazy(
                                async () => () => <EmojiStoreModal />,
                                "CustomEmojiStoreSheet"
                            );
                        }
                    }}
                />
                <FormRow
                    label="Force Resync Emojis"
                    subLabel={`Cached Emojis: ${storage.emojis?.length || 0}`}
                    onPress={() => syncEmojisFromBot(true)}
                />
            </FormSection>

            <FormSection title="Configuration">
                <FormInput
                    title="User App ID"
                    value={storage.selectedAppId || ""}
                    placeholder="Enter Application ID"
                    onChange={(val: string) => {
                        storage.selectedAppId = val.trim();
                    }}
                />
                <FormSwitchRow
                    label="Bot Ping -> User Ping"
                    subLabel="Triggers user notification when proxy bot is mentioned"
                    value={storage.botPingToUserPing ?? true}
                    onValueChange={(val: boolean) => {
                        storage.botPingToUserPing = val;
                    }}
                />
            </FormSection>

            <FormSection title="Live Diagnostic Logs">
                {(storage.debugLogs || []).map((entry: string, idx: number) => (
                    <RN.Text key={idx} style={{ color: "#aaa", fontSize: 11, marginVertical: 2 }}>
                        {entry}
                    </RN.Text>
                ))}
            </FormSection>
        </RN.ScrollView>
    );
}

// --- MAIN PLUGIN LIFECYCLE ---
export default {
    settings: Settings,
    onLoad() {
        if (!storage.emojis) storage.emojis = [];
        if (!storage.apps) storage.apps = [];
        if (!storage.debugLogs) storage.debugLogs = [];
        if (storage.botPingToUserPing === undefined) storage.botPingToUserPing = true;

        // Visual Module Diagnostic Check
        const checks = [
            `MsgActions: ${MessageActions ? "✅" : "❌"}`,
            `RestAPI: ${RestAPI ? "✅" : "❌"}`,
            `ActionSheet: ${LazyActionSheet ? "✅" : "❌"}`,
            `ChatInput: ${ChatInput ? "✅" : "❌"}`,
        ];
        const statusReport = checks.join(" | ");
        logStatus(`Modules: ${statusReport}`);
        showToast(`${PLUGIN_TAG} Loaded (${statusReport})`, 1);

        // 1. Fallback /emojistore Slash Command
        try {
            unpatches.push(
                registerCommand({
                    name: "emojistore",
                    displayName: "emojistore",
                    description: "Open your custom User App Emoji picker",
                    displayDescription: "Open your custom User App Emoji picker",
                    options: [],
                    execute: () => {
                        if (LazyActionSheet?.openLazy) {
                            LazyActionSheet.openLazy(
                                async () => () => <EmojiStoreModal />,
                                "CustomEmojiStoreSheet"
                            );
                        } else {
                            showToast(`${PLUGIN_TAG} ActionSheet module unavailable`, 2);
                        }
                    },
                })
            );
            logStatus("Registered /emojistore slash command");
        } catch (e) {
            logStatus(`Failed to register slash command: ${e}`, true);
        }

        // 2. Chat Bar Accessory Button Injection
        if (ChatInput) {
            try {
                const target = ChatInput.default || ChatInput;
                unpatches.push(
                    patcher.after("render", target.prototype || target, (_, res) => {
                        try {
                            if (!res?.props) return res;
                            const children = res.props.children;
                            if (!children) return res;

                            const Button = (
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
                                    style={{ paddingHorizontal: 8, justifyContent: "center" }}
                                >
                                    <RN.Text style={{ fontSize: 20 }}>💎</RN.Text>
                                </RN.TouchableOpacity>
                            );

                            if (Array.isArray(children)) {
                                children.unshift(Button);
                            }
                        } catch {}
                        return res;
                    })
                );
                logStatus("Patched ChatInput bar");
            } catch (e) {
                logStatus(`ChatInput patch error: ${e}`, true);
            }
        }

        // 3. Message Interception (Outgoing ;emoji; proxying)
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
                            (match, tag) => {
                                const found = emojiMap.get(tag.toLowerCase());
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
                                logStatus(`Proxying emoji message via bot interaction...`);
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

        // 4. Chat Rendering Local Parser
        if (RowManager?.createRowFromMessage) {
            unpatches.push(
                patcher.after("createRowFromMessage", RowManager, (_, res) => {
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

        // 5. Bot Ping Forwarder
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

        // 6. ActionSheet (Long Press Context Menu Hook)
        if (LazyActionSheet?.openLazy) {
            unpatches.push(
                patcher.before("openLazy", LazyActionSheet, (args) => {
                    const [factory, key] = args;
                    if (key === "MessageLongPressActionSheet" || key === "MessageActionsActionSheet") {
                        args[0] = async () => {
                            try {
                                const Component = await factory();
                                return (props: any) => {
                                    try {
                                        const rendered = Component(props);
                                        const message = props?.message;
                                        const content = message?.content || "";
                                        const app = getActiveApp();

                                        if (!rendered || !app) return rendered;

                                        const matches = Array.from(content.matchAll(emojiRegex));
                                        if (matches.length > 0) {
                                            const stealButtons = matches.map((m) => {
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
                                                            backgroundColor: "rgba(255,255,255,0.06)",
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

                                            return (
                                                <RN.View style={{ flex: 1 }}>
                                                    {rendered}
                                                    <RN.View style={{ padding: 12 }}>{stealButtons}</RN.View>
                                                </RN.View>
                                            );
                                        }
                                        return rendered;
                                    } catch (renderErr) {
                                        logStatus(`ActionSheet render error: ${renderErr}`, true);
                                        return Component(props);
                                    }
                                };
                            } catch (e) {
                                logStatus(`ActionSheet factory error: ${e}`, true);
                                return factory();
                            }
                        };
                    }
                    return args;
                })
            );
            logStatus("Hooked Message Long Press ActionSheet");
        }

        // Kick off sync
        syncEmojisFromBot(false);
    },

    onUnload() {
        for (const unpatch of unpatches) {
            try {
                if (typeof unpatch === "function") unpatch();
            } catch {}
        }
        unpatches = [];
        logStatus("Unloaded all patches.");
    },
};
