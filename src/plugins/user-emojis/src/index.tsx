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

export function closeEmojiModal() {
    if (LazyActionSheet?.hideActionSheet) {
        LazyActionSheet.hideActionSheet();
    }
}

export function openEmojiModal() {
    if (LazyActionSheet?.openLazy) {
        LazyActionSheet.openLazy(
            async () => () => <EmojiStoreModal />,
            "CustomEmojiStoreSheet"
        );
    } else {
        showToast(`${PLUGIN_TAG} ActionSheet unavailable`, 2);
    }
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

// --- EMOJI STORE MODAL (COMPACT BOTTOM SHEET WITH CLOSE BUTTON) ---
function EmojiStoreModal() {
    const [tab, setTab] = React.useState<"emojis" | "market">("emojis");
    const [search, setSearch] = React.useState("");
    const [selectedPack, setSelectedPack] = React.useState("All");
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

    const packs = Array.from(
        new Set(
            emojis.map((e) => {
                const parts = e.name.split("_");
                return parts.length > 1 ? parts[0] : "Other";
            })
        )
    ).sort();
    packs.unshift("All");

    const filteredEmojis = emojis.filter((e) => {
        const matchesSearch = e.name.toLowerCase().includes(search.toLowerCase());
        if (!matchesSearch) return false;
        if (selectedPack === "All") return true;
        const parts = e.name.split("_");
        const packName = parts.length > 1 ? parts[0] : "Other";
        return packName.toLowerCase() === selectedPack.toLowerCase();
    });

    const handleSendEmoji = (emoji: AppEmoji) => {
        const channelId = SelectedChannelStore?.getChannelId();
        if (!channelId) {
            showToast(`${PLUGIN_TAG} No active channel found`, 2);
            return;
        }
        const tag = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
        try {
            MessageActions.sendMessage(channelId, { content: tag });
            closeEmojiModal();
        } catch {
            RN.Clipboard.setString(tag);
            showToast(`${PLUGIN_TAG} Copied :${emoji.name}: to clipboard!`, 1);
            closeEmojiModal();
        }
    };

    return (
        <RN.View
            style={{
                height: 380,
                backgroundColor: "#1e1f22",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
            }}
        >
            {/* Header with Title and Close Button */}
            <RN.View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: "rgba(255, 255, 255, 0.1)",
                }}
            >
                <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <RN.Text style={{ fontSize: 18 }}>💎</RN.Text>
                    <RN.Text style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>
                        Custom Emojis ({emojis.length})
                    </RN.Text>
                </RN.View>

                <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <RN.TouchableOpacity
                        onPress={() => syncEmojisFromBot(true)}
                        style={{
                            paddingVertical: 4,
                            paddingHorizontal: 8,
                            backgroundColor: "rgba(88, 101, 242, 0.2)",
                            borderRadius: 6,
                        }}
                    >
                        <RN.Text style={{ color: "#5865F2", fontSize: 12, fontWeight: "600" }}>
                            Resync
                        </RN.Text>
                    </RN.TouchableOpacity>
                    <RN.TouchableOpacity
                        onPress={closeEmojiModal}
                        style={{
                            backgroundColor: "rgba(255,255,255,0.1)",
                            borderRadius: 14,
                            width: 28,
                            height: 28,
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <RN.Text style={{ color: "#fff", fontSize: 14, fontWeight: "bold" }}>✕</RN.Text>
                    </RN.TouchableOpacity>
                </RN.View>
            </RN.View>

            {/* Navigation Tabs */}
            <RN.View
                style={{
                    flexDirection: "row",
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    gap: 8,
                }}
            >
                <RN.TouchableOpacity
                    onPress={() => setTab("emojis")}
                    style={{
                        paddingVertical: 6,
                        paddingHorizontal: 16,
                        backgroundColor: tab === "emojis" ? "#5865F2" : "rgba(255,255,255,0.06)",
                        borderRadius: 6,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Emojis</RN.Text>
                </RN.TouchableOpacity>
                <RN.TouchableOpacity
                    onPress={() => setTab("market")}
                    style={{
                        paddingVertical: 6,
                        paddingHorizontal: 16,
                        backgroundColor: tab === "market" ? "#5865F2" : "rgba(255,255,255,0.06)",
                        borderRadius: 6,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Pack Market</RN.Text>
                </RN.TouchableOpacity>
            </RN.View>

            {/* Content Area */}
            {tab === "emojis" ? (
                <RN.View style={{ flex: 1, paddingHorizontal: 12 }}>
                    <RN.TextInput
                        value={search}
                        placeholder="Search custom emojis..."
                        placeholderTextColor="#888"
                        onChangeText={setSearch}
                        style={{
                            backgroundColor: "rgba(0,0,0,0.3)",
                            color: "#fff",
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 8,
                            fontSize: 13,
                            marginBottom: 8,
                        }}
                    />

                    {/* Pack Filter Bar */}
                    {packs.length > 2 && (
                        <RN.ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={{ maxHeight: 28, marginBottom: 8 }}
                        >
                            {packs.map((p) => (
                                <RN.TouchableOpacity
                                    key={p}
                                    onPress={() => setSelectedPack(p)}
                                    style={{
                                        paddingHorizontal: 10,
                                        paddingVertical: 3,
                                        backgroundColor: selectedPack === p ? "#5865F2" : "rgba(255,255,255,0.08)",
                                        borderRadius: 12,
                                        marginRight: 6,
                                    }}
                                >
                                    <RN.Text style={{ color: "#fff", fontSize: 11 }}>{p}</RN.Text>
                                </RN.TouchableOpacity>
                            ))}
                        </RN.ScrollView>
                    )}

                    {/* Grid List */}
                    <RN.ScrollView style={{ flex: 1 }}>
                        <RN.View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 16 }}>
                            {filteredEmojis.map((emoji) => {
                                const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=48&quality=lossless`;
                                return (
                                    <RN.TouchableOpacity
                                        key={emoji.id}
                                        onPress={() => handleSendEmoji(emoji)}
                                        style={{
                                            alignItems: "center",
                                            justifyContent: "center",
                                            padding: 4,
                                            backgroundColor: "rgba(255,255,255,0.05)",
                                            borderRadius: 8,
                                            width: 44,
                                            height: 44,
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
                    </RN.ScrollView>
                </RN.View>
            ) : (
                <RN.ScrollView style={{ flex: 1, paddingHorizontal: 12 }}>
                    {loadingPacks && (
                        <RN.Text style={{ color: "#aaa", textAlign: "center", marginTop: 20 }}>
                            Fetching remote packs...
                        </RN.Text>
                    )}
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
                                            syncEmojisFromBot(false);
                                        }}
                                        style={{
                                            backgroundColor: isInstalled ? "#ED4245" : "#5865F2",
                                            paddingVertical: 5,
                                            paddingHorizontal: 10,
                                            borderRadius: 6,
                                        }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "bold" }}>
                                            {isInstalled ? "Uninstall" : "Install"}
                                        </RN.Text>
                                    </RN.TouchableOpacity>
                                )}
                            />
                        );
                    })}
                </RN.ScrollView>
            )}
        </RN.View>
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
                    onPress={openEmojiModal}
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

// --- CHATBAR INJECTION LOGIC ---
function injectEmojiButton(res: any) {
    if (!res || !res.props) return;

    const emojiBtn = (
        <RN.TouchableOpacity
            key="morganite-emoji-btn"
            onPress={openEmojiModal}
            style={{
                justifyContent: "center",
                alignItems: "center",
                paddingHorizontal: 8,
                paddingVertical: 4,
                marginRight: 4,
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
            <RN.Text style={{ fontSize: 20 }}>💎</RN.Text>
        </RN.TouchableOpacity>
    );

    const hasButton = (arr: any[]) =>
        arr.some((child) => child?.key === "morganite-emoji-btn");

    if (Array.isArray(res.props.children)) {
        if (!hasButton(res.props.children)) {
            res.props.children.unshift(emojiBtn);
        }
        return;
    }

    if (res.props.children?.props?.children) {
        const nested = res.props.children.props.children;
        if (Array.isArray(nested)) {
            if (!hasButton(nested)) {
                nested.unshift(emojiBtn);
            }
            return;
        }
    }

    if (res.props.children && typeof res.props.children === "object") {
        res.props.children = [emojiBtn, res.props.children];
    }
}

function patchChatBar() {
    const candidates = [
        { mod: findByName("ChatInputActions", false) || findByProps("ChatInputActions"), name: "ChatInputActions" },
        { mod: findByName("ChatAccessories", false) || findByProps("ChatAccessories"), name: "ChatAccessories" },
        { mod: findByName("ChatInput", false) || findByProps("ChatInput", "renderChatInput"), name: "ChatInput" },
    ];

    for (const { mod, name } of candidates) {
        if (!mod) continue;

        try {
            const propToPatch = mod.default ? "default" : mod[name] ? name : typeof mod === "function" ? "render" : null;
            const target = propToPatch ? mod : Object.keys(mod).find((k) => typeof mod[k] === "function");
            const targetProp = propToPatch || target;

            if (targetProp && typeof mod[targetProp] === "function") {
                unpatches.push(
                    patcher.after(targetProp, mod, (_, res) => {
                        try {
                            injectEmojiButton(res);
                        } catch {}
                        return res;
                    })
                );
                logStatus(`Patched chat bar component via ${name}`);
            }
        } catch (err) {
            logStatus(`Error hooking ${name}: ${err}`, true);
        }
    }
}

// --- MAIN PLUGIN LIFECYCLE ---
export default {
    settings: Settings,
    onLoad() {
        if (!storage.emojis) storage.emojis = [];
        if (!storage.apps) storage.apps = [];
        if (!storage.debugLogs) storage.debugLogs = [];
        if (storage.botPingToUserPing === undefined) storage.botPingToUserPing = true;

        logStatus("Initializing plugin hooks...");

        // 1. Fallback /emojistore Command
        try {
            unpatches.push(
                registerCommand({
                    name: "emojistore",
                    displayName: "emojistore",
                    description: "Open your custom User App Emoji picker",
                    displayDescription: "Open your custom User App Emoji picker",
                    options: [],
                    execute: openEmojiModal,
                })
            );
        } catch {}

        // 2. Chat Bar Accessory Button
        patchChatBar();

        // 3. Message Interception (Sending & Proxying)
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

        // 4. Local Message Rendering (Transform ;emoji; in incoming chat view)
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

        // 5. Bot Mention Interceptor
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

        // 6. ActionSheet Long-Press Hook (Steal Emojis)
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
                                                            closeEmojiModal();
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
                                        return Component(props);
                                    }
                                };
                            } catch (e) {
                                return factory();
                            }
                        };
                    }
                    return args;
                })
            );
        }

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
